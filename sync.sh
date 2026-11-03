#!/usr/bin/env bash
# 论文库同步脚本：提交当前文件夹的改动，并推送到 GitHub 仓库 Bin9chn/paper-library
# 用法：bash sync.sh
#
# 说明：本机 github.com:443 连不上（超时），所以推送走 api.github.com 的
# Git Data API，由同目录的 push-api.mjs 完成。没有改动时它自己会跳过。

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR" || { echo "[x] 进不去目录：$REPO_DIR"; exit 1; }

LOG="$REPO_DIR/sync.log"
say() { echo "[$(date +'%H:%M:%S')] $*" | tee -a "$LOG"; }

# 1. 暂存本地改动（有改动才提交）
git add -A
if git diff --cached --quiet; then
  say "[i] 本地没有新改动"
else
  say "[+] 检测到改动："
  git diff --cached --name-status | head -20 | sed 's/^/    /' | tee -a "$LOG"
  MSG="sync: $(date +'%Y-%m-%d %H:%M')"
  if git -c user.name="Bin9chn" -c user.email="Bin9chn@users.noreply.github.com" commit -q -m "$MSG"; then
    say "[✓] 已提交：$MSG"
  else
    say "[x] 提交失败"
    exit 1
  fi
fi

# 2. 推送（push-api.mjs 会自己比对远程，已一致则跳过）
if node "$REPO_DIR/push-api.mjs" 2>&1 | tee -a "$LOG"; then
  say "[✓] 同步完成"
else
  say "[x] 推送失败，详情见 sync.log"
  exit 1
fi
