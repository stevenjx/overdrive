# 继续开发指南

三条规则先记住，后面所有操作都围着它们转：

1. **`main` 不动**——它只是 `MyLuxy/overdrive` 的镜像，永远能快进。
2. **功能写在 `feat/*`**——当前是 `feat/ps5-manager`，一个功能一个分支。
3. **只从 `build/local` 构建**——它由脚本把 `main` 和功能分支合起来，是装到 PS5 的那份。

## 每天开工

```bash
cd ~/Documents/overdrive
git checkout feat/ps5-manager
npm run preview        # 桌面窗口，改 app/ 下的文件会重启
```

首次需要装依赖（只做一次）：

```bash
cd ps5-react && npm ci && cd ..     # 框架的 npm 包
brew install exfatprogs             # 只有 npm run build 打包镜像时才需要
```

这台机器上 cmake / ninja / nasm / llvm@18 / sdl2 / Pillow 都已经有了，
`npm run setup` 会重复装一遍，可以跳过。先跑一次自检确认环境：

```bash
cd ps5-react && python3 tools/cli.py doctor
```

## 代码地图

| 文件 | 职责 | 什么时候改它 |
| --- | --- | --- |
| `app/ps5manager/api.js` | 三个 HTTP 接口、超时、身份校验 | 服务端加了新接口 |
| `app/ps5manager/discovery.js` | UDP 广播、缓存地址、`findServer` | 换发现端口 / 加手动填 IP |
| `app/ps5manager/library.js` | manifest → 卡片数据 | 卡片要多显示一个字段 |
| `app/ps5manager/install.js` | 选盘、空间检查、下载、安装、清理 | 改安装顺序 / 加进度细节 |
| `app/ps5manager/NasScreen.jsx` | 页面、安装面板、文案 | 改界面 |
| `app/index.jsx` | 路由 | 加新页面 |
| `app/ui/useSections.js` | L1/R1 的 tab 顺序、`on.xxx` | 加新页面 |
| `app/ui/Header.jsx` | 导航栏入口 | 加新页面 |
| `app/ui/Legend.jsx` | 底部按键提示 | 加新页面 |
| `app/i18n/locales/en.json`、`zh-Hans.json` | 文案 | 加任何文字 |

## 预览里能测什么

桌面预览跑的是同一份 JS，所以：

- **能测**：NAS tab、广播发现、清单、封面、卡片网格、安装面板、下载进度、空间不足等错误态
- **测不了**：真正的安装。桌面端的 `Packages.install` 固定返回
  `Installing a PKG requires a PS5.`，`install.js` 里也有 `Platform.OS !== "ps5"` 的拦截。
  最后一步必须上真机。

预览里的日志直接打在终端；PS5 上则写进应用的 `app.log`。代码里统一用 `[nas]` 前缀，
方便过滤：

```bash
grep '\[nas\]' app.log
```

## 不用 PS5 也能把服务端跑起来

开发时最省事的组合是「桌面预览 + 本机 ps5-manager」：

```bash
# 终端 A：服务端（找一个放 pkg 的目录）
cd ~/Documents/ps5-manager
go run ./cmd/server -port 8280 -games ./test-games

# 终端 B：确认信标和接口
printf 'OVERDRIVE/1 DISCOVER ps5-manager' | nc -u -w1 127.0.0.1 48620
curl -s localhost:8280/api/overdrive/manifest | head -c 200
```

`test-games/` 里要有能被扫描器解析出 TitleID 的 PKG，manifest 才会非空。
扫描是启动时做的，加完文件重启一下服务端。

## 改完怎么上机

```bash
./scripts/build-local.sh                  # 同步上游 + 重建 build/local
./scripts/build-local.sh feat/ps5-manager build/local --dispatch   # 顺便触发 Actions
```

本地打包（需要 `mkfs.exfat`）：

```bash
npm run build     # 产出 Overdrive.exfat + update.zip
```

`.exfat` 放到 U 盘顶层 `homebrew/` 目录（U 盘需 exFAT），插上 PS5 由 ShadowMount+ 安装。

## 常见错误对照

| 报错 / 现象 | 含义 |
| --- | --- |
| `broadcast failed` | 广播发不出去：网络屏蔽广播，或 NAS 容器不是 host 网络 |
| `not a ps5-manager` | 端口通了但 `service` 不是 `ps5-manager`，通常是别的服务占了 8280 |
| `no-space` | 所有盘都放不下，检查 `storageRoots` 和 `diskUsage` |
| `Packages.install ... refused` | 9021 上没有 payload loader，或 loader 不支持装 PKG |
| 封面空白 | `EXTERNAL_IP` 填错，PS5 访问不到 `/api/v1/games/{id}/icon` |

## 如果以后要加一个新页面

照 NAS 的接法改六处：新建 `app/<name>/XScreen.jsx` → `app/index.jsx` 注册路由和容器高度 →
`useSections.js` 的 `KEYS2`/`TABS`/`underneath`/`on` → `Header.jsx` 加 `NavItem` 和 `track` →
`Legend.jsx` 加按键提示 → 语言包。页面内部尽量复用 `GameCard`、`Button`、`ProgressBar`，
视觉就不会跑偏。

## 提交与同步的节奏

```bash
git add -A && git commit -m "feat: ..." && git push origin feat/ps5-manager
```

- 一个小功能一个提交，消息写「为什么」而不是「改了什么」
- 上游更新后跑一次 `./scripts/build-local.sh`，冲突按提示 `git add` + `git rebase --continue`
- 改了 `ps5-react/` 才需要 `npm test`，只改 `app/` 不用

## 红线

- 不要点 GitHub 上那条 **Compare & pull request**：它默认 base 是 `MyLuxy/overdrive`，点下去就是给原作者发 PR
- 不要在 `main` 上提交
- 不要在 `build/local` 上手工提交（下次脚本会覆盖）
