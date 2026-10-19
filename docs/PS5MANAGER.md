# 局域网库：从 ps5-manager 直接安装

这个 fork 在 Overdrive 里加了一个 **NAS** 页面：自动发现局域网里的
[ps5-manager](https://github.com/stevenjx/ps5-manager)，列出它管理的 PS5 / PS4 游戏，
选中后一键下载并安装到本机。

原有商店（1800+ 游戏、下载队列、Files、搜索、收藏）全部保持原样，NAS 是独立入口，
不改动静态 catalog、筛选和排序逻辑。

## 它怎么工作

```
┌──────────────┐  ① UDP 广播 :48620        ┌────────────────┐
│  PS5         │ ────────────────────────▶ │  NAS           │
│  Overdrive   │ ◀──────────────────────── │  ps5-manager   │
│              │  ② JSON 应答（端口/名称）  │  beacon        │
│              │                           │                │
│              │  ③ GET /api/overdrive/ping │                │
│              │  ④ GET .../manifest       │  SQLite 游戏库  │
│              │  ⑤ GET .../releases/{id}  │                │
│              │                           │                │
│              │  ⑥ GET /download/{id}/... │                │
│              │ ◀──────────────────────── │  PKG 文件       │
└──────┬───────┘                           └────────────────┘
       │ ⑦ Packages.install(path)
       ▼
  主机安装服务（payload loader :9021）
```

1. **发现**：`LocalNetwork.broadcast` 向 `255.255.255.255:48620` 发探测，
   ps5-manager 的 beacon 原路回 `{service, name, http_port, manifest_path}`。
   拿到地址后还要用 `/api/overdrive/ping` 复核 `service == "ps5-manager"`，
   避免同网段别的服务占用端口时被误认。
2. **清单**：`/api/overdrive/manifest` 只返回 PS5 / PS4 本体（PS3、Switch、DLC 记录不出现）。
3. **安装**：`/api/overdrive/releases/{TitleID}` 返回「本体 → 补丁 → DLC」顺序的直链，
   逐个下载到 `/data/ps5-manager/{TitleID}/`，再交给 `Packages.install`。
   每个包装完立即删除，不会长期占两份空间。

缓存：上次成功的服务器地址存在 `settings.json` 的 `ps5manager` 字段里，
下次打开先试它（3 秒超时），失败再广播。

## 前提

- PS5 已越狱，且 **payload loader 在 9021 端口**（etaHEN 等）——`Packages.install` 依赖它。
  没有 loader 时安装会报 `Packages.install ... refused`，浏览和下载不受影响。
- ps5-manager 为包含 beacon 的版本（`DISCOVERY_PORT` 默认 `48620`）。
- 两者在同一局域网；容器需要 `network_mode: host` 才能收到广播。

## 代码结构

| 文件 | 作用 |
| --- | --- |
| `app/ps5manager/api.js` | 三个 HTTP 接口 + 超时 + 身份校验 |
| `app/ps5manager/discovery.js` | UDP 发现、缓存地址、`findServer` |
| `app/ps5manager/library.js` | manifest 条目 → 现有 `GameCard` 能渲染的形状 |
| `app/ps5manager/install.js` | 下载 + 安装状态机（选盘、空间检查、取消、清理） |
| `app/ps5manager/NasScreen.jsx` | NAS 页面、安装面板 |

接入点（对上游文件的改动只有这些）：

- `app/index.jsx`：注册 `nas` 路由
- `app/ui/Header.jsx`：导航栏加一个 NAS 入口
- `app/ui/useSections.js`：`nas` 加入 L1/R1 的 tab 顺序
- `app/ui/Legend.jsx`：按键提示
- `app/i18n/locales/en.json`、`zh-Hans.json`：文案（其余语言回退英文）

## 构建与安装

```bash
npm run setup      # 首次
npm run preview    # 桌面预览（NAS 页面会提示"需要 PS5"，因为安装依赖主机）
npm run build      # 产出 Overdrive.exfat + update.zip
```

`npm run build` 后按上游 README 的方式把 `.exfat` 放进 U 盘 `homebrew/` 目录安装。
也可以用 fork 的 GitHub Actions 手动触发 `Build` 工作流，产物在草稿 release 里。

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 一直停在"正在查找你的 NAS" | NAS 没开、不在同一网段，或容器不是 host 网络；`printf 'OVERDRIVE/1 DISCOVER ps5-manager' \| nc -u -w1 <NAS_IP> 48620` 手工验证 |
| 找到了服务器但库是空的 | ps5-manager 里还没有 PS5 / PS4 的 PKG，或扫描目录没配对 |
| 下载很快失败 | `/api/overdrive/releases` 里的 `url` 用的是 `EXTERNAL_IP`，NAS 上要填成 PS5 能访问的局域网 IP |
| 安装报 `refused` / 一直 0% | 没有 payload loader（9021），或 loader 版本不支持 PKG 安装 |
| 封面不显示 | 封面走 `/api/v1/games/{id}/icon?mode=cover`，确认 PS5 能访问该地址；不显示时会退回纯色块 + 标题 |

日志：应用把 `[nas]` 前缀的行写进 `app.log`（同上游的日志位置），
桌面预览则直接输出到终端。

## 可以继续做的

- **流式安装**：PS5 的 bgft 支持从 URL 直接装，能省掉本地那份临时文件；
  需要给 `@ps5-react/core` 加一个 `Packages.installFromURL` 原生接口。
- 多台 ps5-manager 时在页面顶部切换（`discoverServers` 已经返回全部结果）。
- NAS 库内搜索 / 按更新时间排序。
- 补丁、DLC 单独勾选安装（`releases` 已经按 `kind` 区分）。
