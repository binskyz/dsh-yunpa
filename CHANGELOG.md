# CHANGELOG

## 0.10.0 — 2026-11-08
首个公开版本。合并 0.8 / 0.9 的改动，并补齐「装得上、看得见、退得回」。

- 改名：`dsh-novel-auth` → **dsh-yunpa**（显示名「云爬」），数据目录 `~/.dsh/private/yunpa`；源码清除本机路径与个人书目，`verify-release` 增「个人信息扫描」
- 站点表外置 `sites.json`；`auth_fetch` 支持 `urls[]` 批量（上限 5）
- 性能：`/edge` 加 60s 缓存（790ms → 5ms）、`/status` 计数 10s 缓存
- 显示：`locale/{en,zh}.json` 提供设置页与插件页的标题，新增 `icon.svg`
- **`install.mjs`**：一条命令体检/修复「包目录 + dependencies + bundles + 目录联接 + cordis 条目」；`--check` 只读、`--force` 才动实体副本
- **`recover.mjs`**：崩溃还原（注释挂载 / `--purge` 改名 / `--restore` 回滚），刻意不 import `core.js`
- `check-all.mjs` 13 项（新增「插件页可见性」），`after-restart.mjs` 版本比对不再写死
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
