# Eidolon — Spec Modality Proposal

**Date:** 2026-10-27 · **Author:** Liz, on Chris's model · **Status:** proposal, for the weekend session
**Builds on:** [PRE-ANALYSIS.md](PRE-ANALYSIS.md)

## The model in one paragraph

Chris's model: **Eidolon is a pure specification, versioned.** A tool, app or service that implements it declares which specification version it supports, and every version ships an **acceptance catalogue** in its documentation. That catalogue is also the set of functional acceptance criteria.

This makes sense technically and organisationally. It is the pattern behind the specifications that hold up best:

- **ECMAScript** with test262.
- **CommonMark**, whose spec examples *are* its tests.
- **WebAssembly** with its spec test suite.
- **Kubernetes** and **OCI** with their conformance programmes.
- **MCP** and **LSP**, which are versioned protocols with capability negotiation.

The sections below sharpen the model so it holds up in practice.

---

## 1. The acceptance catalogue must be executable

A catalogue written as prose goes stale as soon as the first implementation outpaces the documentation. With Kumbu² moving weekly, that would happen within days. So we follow CommonMark: **every normative statement has at least one test case, stored as data**:

```yaml
- id: sh.pipe.only-operator
  since: 1.0
  profile: core
  fixture: basic-vault
  call: { tool: sh, command: "ls / && rm /a.md" }
  expect:
    error: true
    matches: "&&.*quote it"
```

The spec documentation renders these cases as examples, and the implementations run them as tests. Acceptance criteria, examples and tests are then **one artefact**, not three that drift apart.

## 2. Profiles, not all-or-nothing

If conformance means "all of Eidolon 1.0", Chatsundere's Stage 2 could not claim it until checkpoints, backlinks and `semsearch` were all done. That works against incremental delivery. Instead, an implementation declares a **spec version plus profiles**:

| Profile | Contents |
|---|---|
| `core` | paths, `ls`/`cat`/`outline`, `write`/`edit`, version tokens, output limit, error conventions |
| `search` | `rg`, `semsearch` |
| `history` | changesets, `history`, `diff`, `restore`, trash |
| `checkpoints` | `mkcp`/`lscp`/`rmcp`, `--checkpoint` |
| `links` | `links`, `backlinks`, link-rewriting `mv` |
| `bulk` | `replace` with plan token, folder moves |
| `mounts` | mount table, per-mount permissions |
| `sync-server` / `sync-client-zk` | the two sync profiles |

An implementation then states, for example, "Eidolon 1.1: core, search, history, bulk". This is the LSP capability model, and it fits staged delivery. Every catalogue case belongs to exactly one profile.

## 3. Discoverable at runtime

The model on the other end must know what it can rely on. The version and profiles should therefore be visible in three places:

- **The tool description:** its first line names the version and profiles.
- **The shell:** `help` (or a dedicated `eidolon --version`) prints them.
- **MCP:** for server profiles, also in `serverInfo` and the `initialize` instructions.

This also lets Chatsundere check a remote mount, such as a Kumbu² vault reached over MCP, before relying on a capability.

## 4. SemVer for the specification, with a defined meaning

- **Minor:** new commands, options or profiles. An agent prompted for 1.0 keeps working.
- **Major:** changed semantics, such as a different section-address format or a different coalescing rule.
- **0.x** stays a draft while Kumbu² is still moving fast.
- **1.0 only when two independent implementations pass the catalogue.** This is the W3C rule. It is especially valuable here, because it filters out Kumbu² behaviour that is accidental rather than intended.

## 5. What the catalogue checks normatively, and what it does not

One trap to settle early: **is the exact wording of error messages normative?** If it is, every improvement to a teaching error becomes a breaking change. Proposal:

- **Normative:** the structure. That covers output formats (`path:line:text`), the rule that an error names the next step, which facts it carries (which operator, which path), and the truncation behaviour.
- **Informative:** the exact wording.
- **Checking:** catalogue cases match on patterns and contained facts, not on whole strings.
- **The man page:** the spec ships a reference text, and implementations may extend it.

## 6. A small adapter interface for the runner

For the same catalogue to run against the C# and the TypeScript implementation, each implementation provides a thin adapter with a handful of operations:

- **Load a fixture:** a file tree, plus versions and checkpoints where needed.
- **Call a tool.**
- **Advance the clock.** Without a controllable clock, changesets (10 or 2 minutes, 1-hour cap) cannot be tested.
- **Act as another writer:** human, agent, a second agent.
- **Simulate a sync conflict:** sync profiles only.

Tokens and timestamps in expected output get placeholders (`<version>`, `<time>`); otherwise nothing is deterministic.

## 7. Two catalogues, kept apart

- **Conformance catalogue:** deterministic. It tests the *implementation*. This is the acceptance catalogue proper, and its result is binary: pass or fail.
- **Agent catalogue:** stochastic. It tests *model plus surface*, with blind tasks such as "rename Hecate everywhere" or "what changed this afternoon?", scored. It is not an acceptance test of an implementation but a quality measurement, and it belongs in a curation harness such as Chatsundere's `/curate`.

Mixing them means a correct implementation fails because a model had a bad day.

## 8. Organisation

- **Its own repository** for the spec, the catalogue and the runner, independent of both products. Both products consume it at a pinned version (submodule or package).
- **Test-first change process:** a spec change is a proposal *with* new or changed catalogue cases. It becomes real when the cases exist. That keeps Eidolon honest.
- **Licensing** (Chris's call):
  - Spec text under CC BY-SA 4.0 (copyleft for documents).
  - Catalogue and runner leaning LGPL, so that any implementation, including one we do not control, can test against the catalogue while the catalogue itself stays free. The aim is that the licence never slows the standard's adoption.

## 9. A plan for the four days

1. **Day 1:** spec skeleton: layers, profiles, versioning rules, catalogue format, adapter interface.
2. **Day 2:** extract Kumbu²'s settled behaviour into catalogue cases. `Kumbu.Core.Tests` and the phase test notes are the richest source. Goal: the `core` profile complete.
3. **Day 3:** build the C# adapter and run Kumbu² against the catalogue. Each deviation is either a Kumbu² bug or a spec question; both are worth having.
4. **Day 4:** build the TypeScript adapter over Chatsundere's Stage 1 file system, so that `core` runs there against the same catalogue. That is the proof the model holds. In parallel, catalogue cases for `history` and `search`.

## In short

A versioned specification with an acceptance catalogue per version is the right shape. Three additions make it work: keep the catalogue executable, introduce profiles, and make the version discoverable at runtime. Then the specification, the acceptance criteria and the tests are one and the same artefact.
