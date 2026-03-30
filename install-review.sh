#!/bin/bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STT_INSTALL_MODE="local-review" "$SCRIPT_ROOT/install.sh" "$@"
