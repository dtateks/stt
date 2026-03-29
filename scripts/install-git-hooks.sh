#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_SOURCE="$REPO_ROOT/.githooks/pre-push"
HOOK_TARGET="$REPO_ROOT/.git/hooks/pre-push"

if [[ ! -f "$HOOK_SOURCE" ]]; then
	echo "ERROR: missing hook source at $HOOK_SOURCE" >&2
	exit 1
fi

chmod +x "$HOOK_SOURCE"
install -m 0755 "$HOOK_SOURCE" "$HOOK_TARGET"

echo "Installed pre-push hook to $HOOK_TARGET"
