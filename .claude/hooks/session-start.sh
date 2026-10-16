#!/bin/bash
# Installs workspace dependencies at the start of a Claude Code cloud session,
# so `pnpm lint`, `pnpm typecheck` and `pnpm build` work right away.
set -euo pipefail

# Cloud sessions only; local machines manage their own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# HUSKY=0 skips the `prepare` git-hook install; it isn't needed in a session.
HUSKY=0 pnpm install --prefer-offline
