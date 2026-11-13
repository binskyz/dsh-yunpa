# CHANGELOG

## 0.10.5 — 2026-11-13
自检不再被偶发网络抖动打红。

- 联网探针改三重试（间隔 600ms）：TUN/代理/DNS 冷启动时第一次 `fetch` 偶发 `fetch failed`，实测同一目标连测 5 次全 200（452–2353ms），单次失败不代表站点不可达
- 真实故障仍然会红（三次都失败才抛错），只是不再把噪声当信号

## 0.10.4 — 2026-11-10
`install.mjs` 能自愈悬空链接。

- `node_modules/dsh-yunpa` 是指向被删目录的**悬空符号链接**时，旧版把它判成「实体副本」，既不报告也不修复；插件看起来装着、加载时才失败。现在用 `lstat` + `realpath` 两步判断（`existsSync` 对悬空链接返回 false，单靠它会误判），检测到就直接重连
- 触发场景：在临时目录里跑 `npm i` 会把 profile 的链接改写指向那个目录，删临时目录后链接就悬空了

## 0.10.3 — 2026-11-08
抽屉从「只能看」变成「能自己走」。

- 抽屉加**站点下拉**：选贴吧/NGA/Pixiv/爱丽丝书屋直接跳登录页
- 抽屉加**地址栏**：输入 URL 回车即导航（自动补 `https://`）
- 画面取不到时给一行提示，不再静默破图
- 站点表复用既有的 `/sites` 路由，没为这个下拉新增 host 接口——host 半身改了要重启宿主，能复用就别加

## 0.10.2 — 2026-11-08
发布到 npm 后的两处修正。

- `scripts.install` 改名 `scripts.setup`：npm 会把 `install` 当成安装钩子，别人 `npm i dsh-yunpa` 时会自动执行它去改自己的 profile——这不是包该干的事
- README 增加 npm 安装方式（`dsh plugin add dsh-yunpa`），`files` 补全到 37 个文件（docs / SECURITY / recover / publish / selfcheck / restart）

## 0.10.1 — 2026-11-08
实时画面的三处平台差异修复 + 交互补全。

- **鉴权**：Electron 的 renderer 发 fetch 不带 `Origin`，原规则把它当跨站 → 面板里点击/打字全部 403 `token required`。改为「只有带跨站 `Origin` 才拦」，并由 `/status` 同源下发写操作 token 做双保险
- **`<img>` 取图**：不再校验 `sec-fetch-*`（Electron 同样不带），只靠监听地址 + 浏览器同源策略
- **视口**：CDP 的 `Emulation.setDeviceMetricsOverride` 是会话级的，跨连接不保留；改为在抓帧的同一会话里按 `?w=&h=` 重设，截图尺寸随面板宽度
- 抽屉：纯色不透明背景（壁纸不再透）、滚轮转发、Esc 收起、暂停保留最后一帧
- 自检：`verify-ui` 覆盖六个页签（补 stub 的 `useRef`）、`selfcheck-live.mjs` 跑 5 轮 35 项、`restart.mjs --verify` 一键重启并验收

## 0.10.0 — 2026-11-08
首个公开版本。合并 0.8 / 0.9 的改动，并补齐「装得上、看得见、退得回」。

- 改名：`dsh-novel-auth` → **dsh-yunpa**（显示名「云爬」），数据目录 `~/.dsh/private/yunpa`；源码清除本机路径与个人书目，`verify-release` 增「个人信息扫描」
- 站点表外置 `sites.json`；`auth_fetch` 支持 `urls[]` 批量（上限 5）
- 性能：`/edge` 加 60s 缓存（790ms → 5ms）、`/status` 计数 10s 缓存
- 显示：`locale/{en,zh}.json` 提供设置页与插件页的标题，新增 `icon.svg`
- **`install.mjs`**：一条命令体检/修复「包目录 + dependencies + bundles + 目录联接 + cordis 条目」；`--check` 只读、`--force` 才动实体副本
- **`recover.mjs`**：崩溃还原（注释挂载 / `--purge` 改名 / `--restore` 回滚），刻意不 import `core.js`
- `check-all.mjs` 13 项（新增「插件页可见性」），`after-restart.mjs` 版本比对不再写死
- **实时画面**：`/api/yunpa/live.{png,info,click,type,key,scroll,nav}` + 右边缘浮层抽屉（`shell.overlay`），受控浏览器画面嵌在界面里，可拖动、可收起、位置记忆，agent 的每一步操作实时可见
- 首次公开：`CONTRIBUTING.md`、`SECURITY.md`、`docs/发布清单.md`，以及 GitHub issue 表单、PR 模板、CI 与 Release 工作流

## 0.7.0 — 2026-11-07
安全审计修复包。
- 移除裸主密钥（`key.bin`），主密钥一律 DPAPI 包裹；遗留文件自动清理
- 密码迁移改用系统 temp profile，读完 `Login Data`/`Local State` 立即删除
- 设置页 API：去掉 `Access-Control-Allow-Origin: *`，跨站 403，写操作需 `x-yunpa-token`
- 只按本插件 profile 精确杀浏览器进程（不再 `taskkill /IM chrome.exe`）
- `upgrade.mjs` 加 sha256 pin + 临时目录解包校验版本后再替换
- 启动清理 `netlog*` / 测试 profile；截图改落 `shots/` 仅保留 20 张
- 错误信息脱敏（抹掉 URL query）；工具层用户名打码
- 新增审计日志 `audit.jsonl` 与 `GET /audit`

## 0.6.0
默认改用 `chrome-headless-shell`（282.6MB，无窗口）；外部连接降到 0（拦 11 个 Google 后台域名）；
`launchBrowser(url,{visible})` 仅在人工登录/自动填充时开窗；新增 `upgrade.mjs`。

## 0.5.0
设置页（`settings.section`，四页签）+ 同源 API（`/status /vault /edge /probe /forget /action`）。

## 0.4.0
照 companion 骨架重铺动作层：`browser_open/snapshot/click/type/press/scroll/tabs/wait/wait_login` +
`auth_fill_from_vault`；密码框默认拒填。

## 0.3.0
自带 Chrome for Testing；Edge 密码库读取（v10 解 / v20 识别）；`auth_pw_open` / `auth_pw_grab`；CSV 导出。

## 0.2.0
凭据库改 DPAPI + AES-256-GCM；自动填表、验证码交图、浏览器单例。

## 0.1.0
初版：`auth_*` 六件套 + 加密 cookie 库。

## 0.8.0 — 2026-11-07
功能完善 + 换路规则落地。
- 站点表外置：`~/.dsh/private/yunpa/sites.json`（内置 tieba/nga/pixiv/alicesw 兜底），`saveSites()` 热更新，加站不用改代码
- `auth_fetch` 支持 `urls[]` 批量（上限 5，串行 + 600ms 间隔，逐条回状态）；`url` 改为可选，运行期校验
- 崩溃链路补全：客户端 `inject` 修复、apply try/catch、全局 error 上报、宿主 uncaught/unhandled → `crash.jsonl`；`/crashes` 查询；`tools/recover.mjs` 一键还原
- 规则：AGENTS.md 新增「换路规则 2.2 优化版」（同根因第 2 次即触发 / 必须换载体 / 先写三行）

## 0.9.0 — 2026-11-07
设置页增强。
- 新增「站点」页签：列出 `sites.json` 全部站点（键/域名/标记）、可删除、可加站点（site/domain/login/probe/marker）
- 诊断页新增「审计」「崩溃」两张表（各 10 条）+ 刷新按钮；概览新增「审计 / 崩溃」计数卡
- 概览浏览器状态 10 秒轮询；`/status` 增加 `counts`；`/audit` 支持 `limit`
- 新增 `GET /sites`、`POST /sites`（set/del，写审计）

## 0.9.1 — 2026-11-07
性能与界面回归。
- `/edge` 60 秒缓存（`?fresh=1` 绕过）：790ms → 5ms
- `/status` 的日志计数 10 秒缓存
- 新增 `verify-ui.mjs`：stub React 渲染四个页签并断言文案；接入 `check-all`（第 12 项）

## 0.10.0 — 2026-11-07
抓取能力 + 提速。
- `auth_fetch` 新增 `pages`（贴吧 `pn=` / NGA `page=`）：翻页合并、去重、楼层连续编号
- 翻页优先走受控浏览器（Node 直连贴吧 403），楼层从 DOM 提取（`.d_post_content` / `.postcontent`）
- 新增 `kind:"threads"`：贴吧吧列表提取帖子标题+链接（标题、URL 一起回）
- `check-all` 提速：出网等待 9s→6s，冷启动 61s → 热跑 ~33s
- `recover.mjs`、`after-restart.mjs` 随插件一起拷进 profile
- 界面：概览首屏「加载中…」骨架、密码库显示「缓存 Ns 前」
