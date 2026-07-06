#!/usr/bin/env bash
# Backwards-compatible alias — superseded by ./dev-infra.sh, which additionally
# ensures the databases exist and runs the migrations.
exec "$(dirname "$0")/dev-infra.sh"
