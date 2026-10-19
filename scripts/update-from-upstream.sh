#!/usr/bin/env bash
# 一键同步上游，并把当前功能分支叠到最新代码上。
#
#   main   永远只是 MyLuxy/overdrive 的镜像，不在上面直接开发
#   feat/* 自己的功能，rebase 到 upstream/main 之上
#
# 用法：
#   ./scripts/update-from-upstream.sh                 # 同步 main + rebase 当前分支
#   ./scripts/update-from-upstream.sh feat/ps5-manager
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交的改动，先 commit 或 stash 再同步。" >&2
  git status --short >&2
  exit 1
fi

echo "==> 拉取上游 MyLuxy/overdrive"
git fetch upstream --prune --tags

echo "==> 同步 main（仅快进，不产生本地提交）"
git checkout main
git merge --ff-only upstream/main
git push origin main

if [ "$BRANCH" = "main" ]; then
  echo "==> 当前在 main，已同步完成。"
  exit 0
fi

echo "==> 把 $BRANCH 叠到 upstream/main 之上"
git checkout "$BRANCH"
if ! git rebase upstream/main; then
  cat >&2 <<'EOF'

rebase 停在冲突处。处理方式：
  1. 编辑冲突文件，git add <文件>
  2. git rebase --continue
  3. 想放弃这次同步：git rebase --abort
EOF
  exit 1
fi

echo "==> 推送 $BRANCH 到 fork"
git push --force-with-lease origin "$BRANCH"

echo "==> 完成：$BRANCH 已基于 upstream/main $(git rev-parse --short upstream/main)"
