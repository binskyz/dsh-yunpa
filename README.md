# dsh-yunpa

DeepSeek Harness（DSH）插件：**本地加密凭据库 + 无头浏览器登录态 + 带登录态抓取**。
面向"登录墙后面的内容"——贴吧、NGA、Pixiv、爱丽丝书屋这类站点，一次登录，之后由 agent 复用。

- 凭据只存本机：DPAPI 包裹主密钥 + AES-256-GCM，明文不落盘、不进对话
- 浏览器默认 **headless-shell 无窗口**，外部连接 0（拦掉 11 个 Google 后台域名）
- 设置页在 DSH 设置里（「云爬」），五个页签：概览 / 凭据库 / 密码库 / 站点 / 诊断
- 31 个 `auth_*` + `browser_*` 工具，动作层走 CDP，无第三方依赖

## 安装

**从 npm（推荐）**

```bash
dsh plugin add dsh-yunpa
```

装完重启 DSH → 设置里出现「**云爬**」，左侧栏多一个云图标。

**从源码（改代码时用）**

```bash
git clone https://github.com/binskyz/dsh-yunpa.git
cd dsh-yunpa
node install.mjs            # 登记 dependencies + bundles + 目录联接 + cordis 条目（幂等，改前备份）
node install.mjs --check    # 只体检：八项，缺什么直接告诉你
```

重启 DSH → 设置里出现「**云爬**」。

`install.mjs` 做的事就是 DSH 插件「装好了」的四个条件，少一件的表现各不相同：

| 少哪件 | 症状 |
|---|---|
| profile `dependencies` 没登记 | 插件在跑，但「设置 → 插件 → 已安装」里查无此人 |
| `dsh.profile.bundles` 没写 | 装了不挂载，工具一个都不出现 |
| `node_modules/dsh-yunpa` 不是指向本源 | 改了代码不生效，两边版本悄悄分叉 |
| `cordis.yml` 缺 insert（或写重两条） | 不加载，或开关互相覆盖 |

不想用联接、想手工放一份副本也行：把目录拷进 `profile/node_modules/`，再在 `cordis.patch.yml` 末尾加

```yaml
- insert:
    - id: yunpa
      name: 'dsh-yunpa'
      config: {}
```

出问题时先跑 `node recover.mjs --status`，再用 `node recover.mjs` 把挂载摘掉（详见 [docs/崩溃与还原.md](docs/崩溃与还原.md)）。

## 首次使用

```bash
node check-all.mjs          # 13 项自检，全绿再动手
node upgrade.mjs            # 看浏览器版本（--apply 更新，sha256 校验 + 版本校验）
```

工具侧（在对话里说）：

| 你说 | 动作 |
|---|---|
| 登录贴吧 / 帮我登 NGA | `auth_login` mode=browser（唯一会弹窗的路径） |
| 用账号密码登 | `auth_login` mode=form（要验证码时给码再调一次） |
| 抓登录态 | `auth_capture`（可 `wipeProfile` 抓完清 profile） |
| 看登录态 | `auth_status` |
| 抓这个链接 | `auth_fetch`（`kind:"posts"` 楼层 / `kind:"threads"` 吧列表） |
| 翻页抓 | `auth_fetch {pages:20}`（贴吧 pn、NGA page，合并去重、楼层连号） |
| 记住账号密码 / 忘了它 | `auth_vault` set / forget |
| 我把 cookie 给你 | `auth_cookie` |
| Edge 里有什么密码 | `auth_edge_list` |
| 把密码迁移出来 | `auth_pw_open` → 点一次自动填充 → `auth_pw_grab` |

## 一次登录能做什么

```
贴吧：吧列表(kind=threads) → 帖内楼层(kind=posts, pages=20) → 结构化 JSON 落盘
NGA ：帖内楼层(pages=N)   → 作者+正文
Pixiv：作品/系列页 → 正文
书屋：书目 → 章节 → 正文
```

## 隐私与限制（务必读）

- **Windows-only**：DPAPI / icacls / PowerShell 共享读。
- **profile 内 cookie 是 v10**：同用户进程可解；敏感站点建议 `auth_capture {wipeProfile:true}`。
- **Edge 密码库有两条路**：`v10` 条目能就地解密（本机 DPAPI）；`v20` App-Bound 解不开，只能让浏览器自己填充后读 DOM（`auth_pw_*`）。迁移时会把 `Login Data` 与 `Local State` 里的密钥复制进受控 profile 供其自动填充——**等于复制了一份密码库**，用完即删（细节见 [docs/安全审计.md](docs/安全审计.md)）。
- **CDP 调试口**只绑 127.0.0.1:9333–9336，本机任意进程可连；不用就 `auth_browser_close`。
- 无 OS 级隔离，浏览器以你的用户权限运行。

## 开发

```
core.js      凭据库 / CDP / 抓取 / 审计日志
browser.js   快照-编号-ref 动作层
edge_creds.js  Edge 密码库读取（v10 解密 / v20 识别）
pwmigrate.js   密码迁移（临时 profile，用后即焚）
api.js       设置页 API（同源校验 + CLI token）
client.js    设置页（手写 ModuleLoader 包）
```

自检：`node check-all.mjs`（13 项）／`node smoke.mjs`（加载期冒烟，不需要浏览器）。

## License

MIT。仅供在你自己的账号与设备上使用；凭据安全由本机 DPAPI 与你的系统账户边界保证。
