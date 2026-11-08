# dsh-yunpa · 命令词与用法（v0.2.0）

## 一句话换对话

新开对话时只要说下面任意一句，模型认表不用解释背景：

- 「登录贴吧」→ 开受控 Edge 窗口，你登录完调 `auth_capture` 存下来
- 「自动登录 NGA，验证码我报你」→ `auth_login mode=form` → 返回验证码图片 → 你说码 → 带 captcha 再调一次
- 「看登录态」→ `auth_status`（含每个站 cookie 数、过期剩余天数、实地探针）
- 「抓这个链接」→ `auth_fetch`（贴吧/NGA 加 `kind=posts` 直接出楼层）
- 「记住 NGA 的账号密码」→ `auth_vault set`
- 「删掉 pixiv 的登录」→ `auth_vault forget site=pixiv`
- 「关掉那个浏览器」→ `auth_browser_close`

## 站点键

| 键 | 站点 | 关键 cookie |
|---|---|---|
| `tieba` | 百度贴吧 | `BDUSS`、`STOKEN`、`BAIDUID` |
| `nga` | NGA 玩家社区 | `ngaPassportUid`、`ngaPassportCid` |
| `pixiv` | Pixiv | `PHPSESSID`、`device_token` |
| `alicesw` | 爱丽丝书屋 | `PHPSESSID` |
| 任意域名 | 直接写 `example.com` | — |

## 三种入库方式

1. `auth_login mode=browser` → 人工登录 → `auth_capture`（最稳，能过滑块）
2. `auth_login mode=form` → 自动填表 → 验证码交图 → 报码 → 二次调用完成
3. `auth_cookie` → F12 里抄 `k=v; k2=v2` 直接灌

## 命令行（不开 DSH 也能用）

```bash
cd ~/.dsh/profiles/desktop/node_modules/dsh-yunpa
node check-all.mjs                                  # 六项自检，全绿再用
node cli.js status                                  # 各站登录态
node cli.js vault-set --site nga --user 你的号 --pass 你的密码
node cli.js open --site tieba                       # 开窗口去登录
node cli.js capture --site tieba                    # 登录完抓 cookie
node cli.js fetch --site tieba --url "https://tieba.baidu.com/p/6051758231?see_lz=1" --kind posts
node cli.js close
```

## 自检覆盖什么

| 检查 | 判据 |
|---|---|
| 模块导入 + apply | 注册出 8 个工具 |
| 参数 schema | 与 DSH 自带 `defineTool` 产物逐字段等价（8/8）|
| 凭据库 | DPAPI 包裹主密钥，AES-256-GCM 往返可解 |
| 明文 | vault.bin 里搜不到明文密码 |
| 联网 | 书屋书目页 200 |
| 浏览器链路 | 开窗→导航→填表→识别验证码框→截图→关窗 |

## 回滚

```powershell
# 注释掉 profile 里的那条 insert 即可卸载
notepad $env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml
# 或直接用备份覆盖
Copy-Item $env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak-* `
          $env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml -Force
```

## v0.3 · 我自己的浏览器 + 密码转移

### 我自己的浏览器
`~/.dsh/private/yunpa/cft/chrome-win64/chrome.exe`（Chrome for Testing 157.0.8103.38，独立 profile `edge-profile`）。
日常所有 `auth_*` 抓取都走它，不碰你日常 Chrome/Edge 的账号。

```bash
node cli.js open --site tieba     # 用我自己的 Chrome 开
node cli.js close
```

### Edge 密码库现状（实测 2026-11-07）
```
总条目 118，v10 可离线解密 0，v20(App-Bound) 111，空 7
```
v20 是 Edge 127+ 的 App-Bound 加密，密钥由浏览器的高权限服务持有，**离开浏览器进程解不开**。
唯一正路：让 Edge 自己解密 → 填进 DOM → 我读 DOM。

### 两条可用路线

**A. 半自动（稳，一次一点击）**
1. `auth_pw_open {origin:"https://soutushenqi.com/login"}` → 受控 Edge 打开登录页（已同步你的密码库）
2. 你点一下账号框，选 Edge 弹出的自动填充建议
3. `auth_pw_grab` → 我读 DOM 存进加密库（明文只在本机）

**B. 全自动尝试（不一定成功）**
`auth_dump_passwords {hosts:"qq,baidu", limit:3}` —— 脚本自己点击+方向键选第一条自动填充，
实测在部分站点触发不了（Edge 对合成事件有手势判定），失败会返回 `needs_click` 让你补一下。

### 导出给我自己的浏览器 / 你的 Chrome
```bash
node cli.js export-csv --out .dsh-login/passwords.csv   # Chrome 设置→密码→导入
```

## v0.4 · 用 companion 的骨架重铺（31 个工具）

采纳的骨架：**持久 profile + 可见窗口 + 快照编号 ref + 按 ref 操作**（和 dsh-browser-companion 同一套流程），动作层用 CDP 自己实现，不依赖 agent-browser / 全局 npm。

### 动作层（12 个）

| 工具 | 说明 |
|---|---|
| `browser_open` | 开可见窗口并导航（profile 持久，登录态保留） |
| `browser_snapshot` | 结构快照：标题/URL/正文 + 可交互元素 `ref=e0…`，密码框值显示 `••••` |
| `browser_click` | 按 ref 点击 |
| `browser_type` | 按 ref 输入；**密码框默认拒填**（返回 `password-field-refused`） |
| `browser_press` | Enter / Tab / Escape / ArrowUp / ArrowDown / Backspace |
| `browser_scroll` | up / down / top / bottom |
| `browser_get_text` | 读正文（可给 CSS 选择器） |
| `browser_meta` | 当前标题 + URL |
| `browser_screenshot` | 截图落盘 |
| `browser_tabs` / `browser_new_tab` / `browser_close_tab` | 标签页管理 |
| `browser_wait` | 等 selector / URL 片段 / 某站登录 cookie |
| `browser_wait_login` | companion 同名：等登录 cookie 就位（贴吧认 `BDUSS`），不用 sleep 猜 |

### 对 companion 四个缺点的补

| companion 的缺点 | 这版怎么补 |
|---|---|
| 拒填密码 → 不能自动登录 | 新增 `auth_fill_from_vault`：凭据只从加密库出，按 ref 填账号+密码，可选 Enter 提交；`browser_type` 仍然拒填，避免模型乱塞明文 |
| cookie 明文躺 profile | 保留加密库：`auth_capture` 把 cookie 写进 DPAPI+AES-256-GCM 的 vault，profile 只是运行态 |
| `browser_wait_login` 只看 cookie/URL，容易误判 | 分站判定：`tieba` 必须见 `BDUSS`；同时支持 selector/URL 三选一组合 |
| 无验证码闭环 | `auth_captcha` 截图 → 你报码 → `auth_login {captcha}` 自动填并提交 |
| 无站点结构化提取 | `auth_fetch {kind:"posts"}` 直接出贴吧/NGA 楼层（作者+正文） |
| 无密码库迁移 | `auth_pw_open` + `auth_pw_grab {waitSec}`（v20 只能让浏览器自己填） |

## v0.5 · 设置页（塞进 DSH 设置，风格照 our-free-model）

设置 → 插件/功能里多一栏 **「云爬」**，五个页签：

| 页签 | 内容 |
|---|---|
| 概览 | 受控浏览器状态（运行中/端口）、账号数、登录态站点数、Edge 密码库条数；按钮：启动浏览器 / 关闭 / 跑自检 / 刷新；已存站点表（站点、cookie 数、账号、更新时间、测试） |
| 凭据库 | 账号表（站点、打码账号、密码位数、来源 vault/edge-pwm/edge-pw-click、保存时间、删除） |
| 密码库 | Edge 登录库：总条数 + 加密方案分布（v10 / v20） + 站点/打码账号/密码位数/方案 |
| 诊断 | 自检三项（库可解密、浏览器、已存站点）+ 数据目录 + 浏览器路径 + 接口清单 |

### 结构

```
host 半身（index.js）
  ├─ ctx.tools.register × 31          工具
  └─ ctx.inject(['webServer']) → server.register({kind:'prefix', path:'/api/yunpa'})
        └─ api.js: /status /vault /edge /probe /forget /action
浏览器半身（client.js，手写 ModuleLoader 包，无构建）
  └─ ctx.slots.inject('settings.section') → register({id:'yunpa', order:36, label:'云爬'})
```

接口都只读本机数据；用户名在接口层就打码（`1*********3`），密码只回长度。

### 验证（不用重启也能跑）

```bash
node ~/.dsh/profiles/desktop/node_modules/dsh-yunpa/check-all.mjs   # 10 项
node ~/.dsh/profiles/desktop/node_modules/dsh-yunpa/test-client.mjs # 半身渲染
```

## v0.8 · 站点外置与批量抓取

**加站点不改代码**：编辑 `~/.dsh/private/yunpa/sites.json`（或让 agent 调 `saveSites`），格式：

```json
{ "mysite": { "domain": "mysite.com", "login": "https://mysite.com/login",
              "probe": "https://mysite.com/", "marker": "退出登录" } }
```

**批量抓取**（`url` 与 `urls` 二选一，`urls` 上限 5 条、串行 600ms 间隔）：

```json
{ "site": "nga", "urls": ["https://bbs.nga.cn/read.php?tid=33739719", "https://bbs.nga.cn/read.php?tid=33739720"], "kind": "posts" }
```

返回 `{status:"batch", count, results:[{url,status,bytes,chars}]}`，逐条独立成败。
