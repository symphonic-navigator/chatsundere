# Prometheus container can't scrape host backends on Linux

**Date logged:** 2026-05-18
**Context:** Phase 0 manual verification of the "Set up monorepo and tooling" squash. Backends running natively on the host (`bun --watch`), Prometheus running in the dev compose stack, expected to scrape `host.docker.internal:3100/3200/3300/metrics`. All three scrapes failed with `context deadline exceeded`.

## Symptom

In `http://localhost:9090/targets`:

```
auth-service   DOWN  Get "http://host.docker.internal:3100/metrics": context deadline exceeded
sync-service   DOWN  (same)
proxy-service  DOWN  (same)
prometheus     UP
```

The host can `curl http://localhost:3100/healthz` and gets `{"status":"ok"}`. The backends are listening on `*:3100` etc. (`0.0.0.0`, all interfaces). The compose file declares `extra_hosts: ['host.docker.internal:host-gateway']` and `prometheus.yml` scrapes `host.docker.internal:3100`.

## Two stacked root causes

### 1. `host-gateway` magic targets the wrong bridge

Docker's `extra_hosts: host.docker.internal:host-gateway` directive is documented as resolving to "the host gateway", but on Linux this consistently means **the `docker0` bridge's gateway IP** (`172.17.0.1`), not the gateway of whichever user-defined bridge the container actually sits on.

`docker compose` always creates a user-defined bridge for the project (in our case `chatsundere-dev_chatsundere-dev`). That bridge gets its own subnet (initially `172.19.0.0/16`, gateway `172.19.0.1`). A container on this bridge has **no route to `172.17.0.1`** — `docker0` is a separate L2 segment.

Verification:

```
$ docker exec chatsundere-dev-prometheus-1 cat /etc/hosts | grep -i docker
172.17.0.1	host.docker.internal     # WRONG — docker0 gateway, not our bridge's

$ docker network inspect chatsundere-dev_chatsundere-dev \
    --format '{{range .IPAM.Config}}gateway={{.Gateway}} subnet={{.Subnet}}{{end}}'
gateway=172.19.0.1 subnet=172.19.0.0/16
```

### 2. UFW drops packets from the docker bridge interface

Even after `extra_hosts` pointed at the correct gateway (the user-defined bridge's IP, `172.19.0.1` in the original run, `172.28.0.1` after pinning), the connection still timed out. The host *itself* could `curl http://172.28.0.1:3100/healthz` fine, but a fresh alpine container on the same bridge could not — `curl --max-time 5` returned `Connection timed out after 5006 milliseconds`.

UFW (active on this host) drops inbound traffic by default on non-loopback interfaces, including the newly-created `br-xxxxxxx` interface backing the user-defined bridge. Docker's iptables rules sit in `DOCKER-USER` and friends; UFW's rules sit in `ufw-user-input`. UFW does *not* know about the bridge interface, so its default policy applies and the SYN packet is dropped silently — hence `context deadline exceeded` rather than the more honest `connection refused`.

## Fix

Both layers had to change. The fix lives in `infra/compose.dev.yml` and is documented in `obsidian/ONBOARDING.md`.

### Pin the bridge subnet + use a static `extra_hosts` IP

```yaml
networks:
  chatsundere-dev:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/24
          gateway: 172.28.0.1

# ... and in the prometheus service:
prometheus:
  extra_hosts:
    - 'host.docker.internal:172.28.0.1'   # NOT 'host-gateway'
```

Pinning the subnet matters: the UFW rule needs a stable source CIDR.

### UFW exception on Linux

```bash
sudo ufw allow from 172.28.0.0/24 to any port 3100:3300 proto tcp \
  comment 'Chatsundere dev: Prometheus scrape host backends'
```

UFW reloads instantly; no compose restart needed. macOS and Windows hosts do not need this step — their Docker stacks route through a VM and `host.docker.internal` resolves to a special bridge that the host firewall does not intercept.

## Related side-quest: Prometheus + Grafana bind-mount permissions

While diagnosing this, an earlier failure surfaced: the `prom/prometheus` image runs as `nobody` (UID 65534) and the `grafana/grafana` image as UID 472, both with **no entrypoint chown** step. A bind-mount under `infra/data/prometheus` (or `infra/data/grafana`) is created by Docker as `root:root` and the container cannot write to it — Prometheus crash-loops with `permission denied` on `/prometheus/queries.active`.

Fix: switch those two services to named Docker volumes. Postgres and Redis keep their bind-mounts because their official images do chown their data dirs in the entrypoint. See commit `c1c8620`.

## Generalisable lesson

Three rules to keep in pocket when wiring containers to host services on Linux:

1. **Never rely on `host-gateway` from a user-defined bridge.** Either pin the subnet and use the gateway IP literally, or run the scraper with `network_mode: host` and pay the isolation cost.
2. **UFW + Docker is a known stack failure.** Source-CIDR-specific `ufw allow` rules work, but you need a stable source CIDR — which means pinning the subnet anyway.
3. **`permission denied` on a bind-mount = run the image as the right UID.** Either pre-create the dir with the container's expected UID, or switch to a named volume. The latter is almost always less painful in dev.

These three multiplied by each other turned what should have been a five-minute `docker compose up -d` into an hour-long diagnostic. The next time will be five minutes.
