# 参与开发

## 这个包的结构

没有构建步骤。改完文件直接生效（重载宿主即可），所以仓库里不存在 `dist/`、`src/` 编译产物——`*.js` 就是源码。

| 文件 | 管什么 |
|---|---|
| `index.js` | Host 半身：31 个工具的注册与参数 schema |
| `core.js` | 全部底层能力：凭据库（DPAPI）、CDP 浏览器、抓取、解析、审计 |
| `api.js` | 设置页的本地 HTTP 接口 `/api/yunpa/*` |
| `client.js` | 浏览器半身：`settings.section` 的五个页签 |
| `browser.js` | `browser_*` 动作层（快照/ref 点击/填表/截图） |
| `edge_creds.js` | 读 Edge 密码库（只读，不解密 v20） |
| `install.mjs` | 一键安装/修复：dependencies + bundles + 联接 + cordis 条目 |
| `recover.mjs` | 崩溃还原：注释挂载 / `--purge` 改名 / `--restore` 回滚；不 import `core.js` |
| `publish.mjs` | 一键发版：校验 token → 替换 OWNER → 复验 → commit → 建仓库 → push → tag → 验证 |
| `check-all.mjs` | 13 项自检，改完必须跑 |
| `verify-release.mjs` | 8 项发布验收，CI 跑的就是它 |
| `after-restart.mjs` | 重启后的加载验收 |
| `sites.json` | 站点表（新站点先加这里，不要改代码） |

## 开发循环

```bash
cd ~/.dsh/plugins-local/dsh-yunpa

node install.mjs --check     # 先看装好没有，红了先修安装
node check-all.mjs           # 13 项，全绿才算改完
node verify-release.mjs      # 8 项，提交前跑
```

`install.mjs` 会把 `~/.dsh/profiles/desktop/node_modules/dsh-yunpa` 做成指向本目录的**目录联接**——所以你在本源目录改完，DSH 里重载就生效，不需要「复制到 node_modules」这一步。

只改 `client.js`（设置页）不需要重启宿主，刷新页面即可；改 host 半身（`index.js`/`core.js`）要重启。

## 提交前

- [ ] `node check-all.mjs` 13 项全绿
- [ ] `node verify-release.mjs` 8 项全绿
- [ ] `node install.mjs --check` 全绿
- [ ] 没把 `~/.dsh/private/yunpa/` 里的任何文件（`vault.bin`、`api-token.txt`、`audit.jsonl`、`shots/`、`cft/`）带进提交
- [ ] 没在代码/文档里写本机绝对路径、用户名、真实站点 cookie
- [ ] 新增的工具在 `index.js` 里有 `parameters`，且能通过 `check-all` 的「参数 schema 与 defineTool 等价」

## 风格

- 纯 ESM，不起构建链；不引入运行时依赖（CI 会拦）
- 注释用中文，写「为什么」不写「是什么」
- 错误一律走 `safeErr`，不要把原始异常体直接抛给模型或 UI
- 新站点优先落到 `sites.json`；确实要专属解析再在 `core.js` 里加函数
- 破坏性动作（删 profile、清凭据）必须带 `--force` 之类的显式开关，并在文档里写清回滚

## 不接受的改动

- 引入任何把 cookie / 密码往外发的通道
- 去掉「密码框拒填」
- 让 `check-all.mjs` 的联网项变成可选（它守的是真实行为，不是形式）
