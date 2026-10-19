# 开发与同步工作流

这个仓库是 [MyLuxy/overdrive](https://github.com/MyLuxy/overdrive) 的 fork。
**不向上游提交任何东西**，只单向同步；自己的功能只在自己的构建里使用。

日常怎么写代码、怎么预览、怎么上机，见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 三条分支，各管一件事

| 分支 | 作用 | 规则 |
| --- | --- | --- |
| `main` | 上游镜像 | 只 `--ff-only` 快进，不直接提交；随时能和上游对比 |
| `feat/ps5-manager` | 自己的功能 | 永远基于最新 `main`，一个功能一个分支 |
| `build/local` | **构建用** | 每次由脚本重建：`main` + `feat` 的合并结果 |

`build/local` 是构建产物对应的分支，装到 PS5 的 `.exfat` 只从它构建。
它由脚本覆盖重建，不要在上面手工提交。

## 日常开发

```bash
git checkout feat/ps5-manager
# ... 改代码 ...
git add -A && git commit -m "feat: ..."
git push origin feat/ps5-manager
```

## 上游更新后：同步 + 重建构建分支

```bash
./scripts/build-local.sh
```

脚本依次做：

1. `git fetch upstream`，把 `main` 快进到 `upstream/main` 并推送；
2. 把 `feat/ps5-manager` rebase 到最新 `main`（你的提交永远在最上面）；
3. 重建 `build/local`：从 `main` 出发 `--no-ff` 合并功能分支，推送；
4. 提示去 Actions 选 `build/local` 构建。

要顺手触发构建：

```bash
./scripts/build-local.sh feat/ps5-manager build/local --dispatch
```

只同步上游、不重建构建分支：`./scripts/update-from-upstream.sh`。

## 在 GitHub 上构建

1. 首次使用：打开仓库的 **Actions** 标签，点一次
   "I understand my workflows, go ahead and enable them"（fork 的 workflows 默认是关的）。
2. 左侧选 **build** → **Run workflow** → 分支选 **`build/local`** → Run。
3. 产物（`Overdrive.exfat` / `update.zip`）在 **Releases** 的草稿里，只有你自己可见；
   下载 `.exfat` 后按上游 README 的方式装到 PS5。

## 关于黄色的 "Compare & pull request"

那是 GitHub 提示「把分支推给上游仓库」。**不要点**——它默认的 base 是
`MyLuxy/overdrive`，点下去就是给原作者发 PR。忽略即可，过几天会自己消失。
你不需要在网页上做任何合并：合并由 `build-local.sh` 在本地完成。

## 同步原理

```
upstream/main ──●──●──●──────────●   作者的新功能
                              │
                              └── rebase
                                  │
feat/ps5-manager  ●──●──●─────────●   你的功能，永远在最上面
                                  │
                                  └── merge --no-ff
                                      │
build/local ──────────────────────────●   构建这条分支
```

用 `rebase` 而不是反复 `merge`：你的提交始终是「最新上游 + 你的功能」，
不会出现上游和你各有一份旧代码、合并后重复实现的情况。
