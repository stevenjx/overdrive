#!/usr/bin/env bash
# 生成"你自己的构建分支"：main（上游镜像）+ feat 分支，构建只从这条分支出。
#
#   main                永远等于 MyLuxy/overdrive，只快进，不发 PR
#   feat/ps5-manager    你的功能
#   build/local         main + feat 的合并结果，Actions 里选它来构建
#
# 用法：
#   ./scripts/build-local.sh                 # 同步 + 重建 build/local 并推送
#   ./scripts/build-local.sh feat/ps5-manager build/local --dispatch
#                                            # 顺便触发 GitHub Actions 构建
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${1:-feat/ps5-manager}"
BUILD_BRANCH="${2:-build/local}"
DISPATCH="${3:-}"
REPO="${REPO:-stevenjx/overdrive}"

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交的改动，先 commit 或 stash。" >&2
  git status --short >&2
  exit 1
fi

if [ "$BRANCH" = "main" ]; then
  echo "功能分支不能是 main：main 只做上游镜像。" >&2
  exit 1
fi

echo "==> 拉取上游 MyLuxy/overdrive"
git fetch upstream --prune

echo "==> main 快进到 upstream/main（不产生本地提交）"
git checkout main
git merge --ff-only upstream/main
git push origin main

echo "==> 把 $BRANCH 叠到最新 main 上"
git checkout "$BRANCH"
if ! git rebase main; then
  cat >&2 <<'EOF'

rebase 停在冲突处：
  1. 编辑冲突文件，git add <文件>
  2. git rebase --continue
  3. 放弃这次同步：git rebase --abort
EOF
  exit 1
fi
git push --force-with-lease origin "$BRANCH"

echo "==> 重建 $BUILD_BRANCH = main + $BRANCH"
git checkout -B "$BUILD_BRANCH" main
git merge --no-ff "$BRANCH" -m "build: merge $BRANCH into $BUILD_BRANCH"
git push --force-with-lease origin "$BUILD_BRANCH"

echo
echo "完成：$BUILD_BRANCH 已包含上游 $(git rev-parse --short upstream/main) 与 $BRANCH 的全部提交。"
echo "在 GitHub → Actions → build → Run workflow 里选择分支 $BUILD_BRANCH 即可构建。"

if [ "$DISPATCH" = "--dispatch" ]; then
  echo "==> 触发构建（分支 $BUILD_BRANCH）"
  gh workflow run build.yml --ref "$BUILD_BRANCH" -R "$REPO" || {
    echo "触发失败。首次使用需要在 GitHub 的 Actions 页面点一次启用 workflows（fork 默认关闭）。" >&2
    exit 1
  }
  echo "已提交构建任务，用 gh run list -R $REPO 查看进度。"
fi
