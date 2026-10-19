#!/usr/bin/env bash
# 把自己开发的功能合并进 main，用于出一版带自定义功能的构建。
#
# 用法：
#   ./scripts/publish-feature.sh feat/ps5-manager          # 合并提交，保留历史
#   ./scripts/publish-feature.sh feat/ps5-manager --squash # 压成一个提交
#
# 合并前会先把功能分支 rebase 到最新 upstream/main，避免带着旧基线发布。
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${1:-}"
MODE="${2:-}"

if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ]; then
  echo "用法: $0 <feat/分支名> [--squash]" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交的改动，先 commit 或 stash。" >&2
  exit 1
fi

echo "==> 拉取上游并 rebase $BRANCH"
git fetch upstream --prune
git checkout "$BRANCH"
git rebase upstream/main

echo "==> 合并进 main"
git checkout main
git merge --ff-only upstream/main
if [ "$MODE" = "--squash" ]; then
  git merge --squash "$BRANCH"
  git commit -m "feat: ps5-manager LAN library integration"
else
  git merge --no-ff "$BRANCH" -m "Merge $BRANCH"
fi

echo "==> 推送 main 与功能分支"
git push origin main
git push --force-with-lease origin "$BRANCH"

echo "==> 完成。main 现在包含 $BRANCH 的功能，且基线是 upstream/main $(git rev-parse --short upstream/main)"
