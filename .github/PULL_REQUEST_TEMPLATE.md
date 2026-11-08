## 先做这三件事

1. **跑自检**，把输出整段贴上来：

   ```bash
   cd ~/.dsh/profiles/desktop/node_modules/dsh-yunpa
   node check-all.mjs
   ```

2. **跑安装体检**（插件页看不到「云爬」、设置页没有入口时必跑）：

   ```bash
   node install.mjs --check
   ```

3. **看清下面这条**：`~/.dsh/private/yunpa/` 里的东西是凭据。贴日志前把 `BDUSS`、`STOKEN`、`cookie`、`account`、`password` 这几项的值删掉，只留结构。仓库不会替你保密。

---

## 自检里的失败项和你的描述等重

`check-all.mjs` 输出 13 项。哪一项红，直接决定我往哪里查——所以别只贴报错最后一行，贴完整的 13 行。

## 常见对应关系

| 红掉的项 | 大概率是什么 |
|---|---|
| 模块导入 + apply 注册 | 包没装全，或 `node_modules/dsh-yunpa` 不是指向本源 |
| 凭据库 DPAPI 加解密 | 数据目录权限被改过，或换了 Windows 账户 |
| 我自己的浏览器（Chrome for Testing） | 没跑过 `auth_browser_install` |
| 插件页可见性 | `dependencies` / `bundles` 少写一件，跑 `node install.mjs` |
| 设置页四页签渲染 | client 半身没加载，重启宿主后再看 |

## 隐私

Issue 是公开的。**不要**贴：cookie 值、账号、密码、真实姓名、学校/单位名、完整本机路径里的用户名。路径可以写成 `C:\Users\<user>\.dsh\...`。
