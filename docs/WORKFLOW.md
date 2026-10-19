# 开发与同步工作流

这个仓库是 [MyLuxy/overdrive](https://github.com/MyLuxy/overdrive) 的 fork，用来在保留上游功能的前提下叠加自己的功能。

## 分支约定

| 分支 | 作用 | 规则 |
| --- | --- | --- |
| `main` | 上游镜像 | **只在同步时快进**，不直接提交，保证随时能对比上游 |
| `feat/*` | 自己的功能 | 永远基于最新 `upstream/main`，一个功能一个分支 |

当前功能分支：`feat/ps5-manager`（局域网 ps5-manager 库与一键安装）。

## 日常开发

```bash
git checkout feat/ps5-manager
# ... 改代码 ...
git add -A && git commit -m "feat: ..."
git push origin feat/ps5-manager
```

## 上游更新后，把自己的功能叠上去

```bash
./scripts/update-from-upstream.sh
```

脚本做三件事：

1. `git fetch upstream`，把 `main` 快进到 `upstream/main` 并推送；
2. 把当前功能分支 `rebase` 到最新的 `upstream/main`；
3. `git push --force-with-lease` 推回 fork。

冲突时按提示 `git add` + `git rebase --continue` 即可。因为功能都集中在新增文件里，对上游原有文件的改动只有导航栏、路由和语言包几处小改动，冲突面很小。

## 发布一版带自己功能的构建

```bash
./scripts/publish-feature.sh feat/ps5-manager
```

它先 rebase 到最新上游，再合并进 `main` 并推送。之后在 fork 的 Actions 里手动触发 `Build` 工作流即可产出 `Overdrive.exfat`。

## 同步原理

```
upstream/main ──●──●──●──────────● (作者的新功能)
                              │
                              └── rebase
                                  │
feat/ps5-manager  ●──●──●─────────● (你的功能，永远在最上面)
```

`rebase` 而不是 `merge` 的原因：你的提交始终是"最新代码 + 你的功能"，不会出现上游和你各有一份旧代码、合并后重复实现的情况。
