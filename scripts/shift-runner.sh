#!/bin/bash
# Bloom-L 勤務シフト実行ラッパー(launchd用)。docs/30参照。
# 認証: ~/.claude/bloom-cron-token.txt に `claude setup-token` の出力を保存しておく(chmod 600)
set -u
SKILL="$1"
REPO="/Users/mizokamimirai/Desktop/mizogamitoshiki/Bloom-L-AI-Company"
TOKEN_FILE="$HOME/.claude/bloom-cron-token.txt"
if [ -f "$TOKEN_FILE" ]; then
  CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
  export CLAUDE_CODE_OAUTH_TOKEN
fi
cd "$REPO" || exit 1
exec /Users/mizokamimirai/.local/bin/claude -p "/$SKILL" --dangerously-skip-permissions
