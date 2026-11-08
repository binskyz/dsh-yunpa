# 安全说明

这个插件管的是**登录态**和**浏览器密码**。它的安全边界写在下面，报告问题时请先对一遍。

## 它怎么保护你的凭据

| 环节 | 做法 |
|---|---|
| 落盘 | 凭据库 `~/.dsh/private/yunpa/vault.bin`，AES-256-GCM 加密，密钥由 Windows DPAPI 包裹（当前用户+当前机器才能解） |
| 内存 | 明文只在进程内存在，不写日志、不进对话、不进记忆分片 |
| 无裸密钥 | 旧版本可能残留 `key.bin`，启动时自动删除 |
| 浏览器 | 独立 profile（Chrome for Testing），不碰你日常浏览器的 profile |
| 出网 | 受控浏览器启动时拦 11 个 Google 后台域名，自检里有一项「外部连接 0」守着它 |
| 本地 API | `/api/yunpa/*` 只在本机 web 服务上，跨站请求 403，写操作要 token（`api-token.txt`） |
| 审计 | 每次敏感动作写 `audit.jsonl`；崩溃写 `crash.jsonl`（都带错误脱敏） |

## 它**不**做的事

- 不把 cookie 发到任何第三方服务（没有云端同步）
- 不在无提示的情况下提交任何表单
- 密码框拒填：`browser_type` 对 `input[type=password]` 直接拒绝，只能走本地凭据库

## 报告漏洞

**不要开公开 issue。** 用 GitHub 的私密报告通道：

> 仓库页 → Security → Advisories → **Report a vulnerability**

或者在 issue 里只写「发现了一个需要私密沟通的问题」，不要带细节。

报告里请给：影响范围（能读到什么/能改什么）、复现前提（需要本地账户？需要 DSH 在跑？）、以及最小复现步骤。**不要**附带真实的 cookie、账号、密码。

## 已知的非问题

这些看起来吓人，但是设计如此，不算漏洞：

1. 同用户的进程能解密 `vault.bin`——DPAPI 的边界就是当前 Windows 账户，不是进程隔离。
2. 受控浏览器的 profile 里 cookie 是 `v10` 可解——它用的是独立 profile，不是 Edge 的 `v20` App-Bound。
3. 调试端口开在 `127.0.0.1:9333-9336`——只监听回环，且端口按 profile 分配。
4. `check-all.mjs` 会启动浏览器并访问 `alicesw` 做联网探针——那是自检的一部分，跑一次就会看到。
