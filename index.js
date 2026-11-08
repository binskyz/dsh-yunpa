// dsh-yunpa v0.2.0 · 登录态插件（Host 半身）
// 加密凭据库(DPAPI) + 受控浏览器(Edge/CDP，单例) + 自动填表 + 验证码交图 + 带登录态抓取/楼层提取
import {
  SITES, ROOT, VAULT, loadVault, saveVault, launchBrowser, closeBrowser, livePort,
  allCookies, autofill, submitForm, captchaTo, goto, fetchWith, probeSite, clearBrowserCookies, audit, safeErr, safeUrl, crash, installCrashHandlers,
  extractPosts, toText, sleep,
} from './core.js'

export const name = 'yunpa'
export const inject = ['tools']

const textOut = (v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }]
const OBJ = (props, required = []) => ({
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(Object.entries(props).map(([k, v]) => {
    const { required: _r, ...rest } = v || {}
    return [k, rest]
  })),
  ...(required.length ? { required } : {}),
})
const OUT = { schema: { type: 'object', additionalProperties: true }, render: textOut }

const TOOLS = []

TOOLS.push({
  name: 'auth_login',
  description: '登录指定站点：browser 模式开受控 Edge 窗口让人工登录/过验证码；form 模式用凭据库账号密码自动填表提交，需要验证码时返回验证码图片路径，把码读给模型后可带 captcha 重调完成。',
  parameters: OBJ({
    site: { type: 'string', required: true, description: '站点键：tieba / nga / pixiv / alicesw，或任意域名' },
    mode: { type: 'string', enum: ['browser', 'form'], required: true },
    captcha: { type: 'string', description: 'form 模式第一次返回 needs_captcha 后，把用户报的验证码填这里再调一次' },
    captchaOut: { type: 'string', description: '验证码图片落盘路径，默认 .dsh-login/captcha.png' },
  }, ['site', 'mode']),
  output: OUT,
  async execute(args) {
    const site = args.site
    const cfg = SITES[site]
    const url = cfg?.login || `https://${String(site).replace(/^https?:\/\//, '')}`
    if (args.mode === 'browser') {
      const b = await launchBrowser(url, { visible: true })
      await goto(url).catch(() => {})
      return {
        status: 'browser_open', site, port: b.port, reused: b.reused, url,
        next: `在 Edge 窗口里登录完 → 调 auth_capture(site=${site})；不要了用 auth_browser_close`,
      }
    }
    const v = await loadVault()
    const acc = v.accounts[site]
    if (!acc?.username) return { status: 'need_credentials', site, hint: '先 auth_vault set 存账号密码' }
    const b = await launchBrowser(url, { visible: true })
    await goto(url)
    const filled = await autofill(acc.username, acc.password)
    if (!filled?.ok) return { status: 'autofill_failed', site, detail: filled, port: b.port }
    if (!args.captcha && filled.needCaptcha) {
      const file = args.captchaOut || ROOT + '/shots/captcha-' + Date.now() + '.png'
      const cap = await captchaTo(file)
      return {
        status: 'needs_captcha', site, port: b.port,
        captchaField: filled.captchaField, file: cap.file || null, found: !!cap.found,
        next: '把图片里的验证码读出来后，带 captcha 参数再调 auth_login',
      }
    }
    const sub = await submitForm(args.captcha || '')
    await sleep(3500)
    const got = await allCookies(b.port, cfg?.domain || site)
    if (!got.length) return { status: 'login_unconfirmed', site, submit: sub, next: '看窗口是否还在报错，或改 browser 模式人工登录' }
    v.cookies[site] = got.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires ?? -1 }))
    v.cookies[`${site}__updated`] = new Date().toISOString()
    await saveVault(v)
    return { status: 'logged_in', site, cookies: got.length, submit: sub, probe: await probeSite(site, v.cookies[site]) }
  },
})

TOOLS.push({
  name: 'auth_captcha',
  description: '把当前登录页上的验证码截图存成图片文件（用户看图报码用）。',
  parameters: OBJ({
    out: { type: 'string', description: '落盘路径，默认 .dsh-login/captcha.png' },
  }),
  output: OUT,
  async execute(args) {
    return captchaTo(args.out || ROOT + '/shots/captcha-' + Date.now() + '.png')
  },
})

TOOLS.push({
  name: 'auth_capture',
  description: '把受控浏览器里已登录的 cookie 抓下来存进加密库（人工登录完成后用它）。「抓登录态」「保存 cookie」都走这里。',
  parameters: OBJ({
    site: { type: 'string', required: true },
    close: { type: 'boolean', description: '抓完是否关掉浏览器，默认 false' },
    wipeProfile: { type: 'boolean', description: '抓完清掉受控 profile 里的 cookie，只留加密库那份，默认 false' },
  }, ['site']),
  output: OUT,
  async execute(args) {
    const port = await livePort()
    if (!port) return { status: 'error', reason: '受控浏览器没在跑，先 auth_login' }
    const got = await allCookies(port, SITES[args.site]?.domain || args.site)
    if (!got.length) return { status: 'empty', site: args.site, reason: '该域名下没读到 cookie，登录可能没完成' }
    const v = await loadVault()
    v.cookies[args.site] = got.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires ?? -1 }))
    v.cookies[`${args.site}__updated`] = new Date().toISOString()
    const saved = await saveVault(v)
    const probe = await probeSite(args.site, v.cookies[args.site])
    await audit('capture', { site: args.site, cookies: got.length })
    let wiped = null
    if (args.wipeProfile) { try { await clearBrowserCookies(); wiped = true } catch { wiped = false } }
    if (args.close) await closeBrowser()
    return { status: 'saved', site: args.site, cookies: got.length, encrypted: saved.dpapi, wiped, probe }
  },
})

TOOLS.push({
  name: 'auth_browser_close',
  description: '关掉受控浏览器窗口。',
  parameters: OBJ({}),
  output: OUT,
  async execute() { return closeBrowser() },
})

TOOLS.push({
  name: 'auth_status',
  description: '看每个站点有没有存 cookie / 账号，并实地探一次登录态。「登录态还在吗」「都存了哪些」用它。',
  parameters: OBJ({ probe: { type: 'boolean', description: '是否真的发请求探测，默认 true' } }),
  output: OUT,
  async execute(args) {
    const v = await loadVault()
    const sites = new Set([...Object.keys(v.cookies), ...Object.keys(v.accounts)].map((k) => k.replace(/__updated$/, '')))
    const rows = []
    for (const site of sites) {
      const ck = v.cookies[site] || []
      const row = { site, cookies: ck.length, account: v.accounts[site]?.username || null, updated: v.cookies[`${site}__updated`] || null }
      const exp = ck.map((c) => c.expires).filter((e) => e > 0)
      if (exp.length) row.expiresInDays = Math.round((Math.min(...exp) * 1000 - Date.now()) / 86400000)
      if (args.probe !== false && ck.length) row.probe = await probeSite(site, ck)
      rows.push(row)
    }
    return { vault: VAULT, root: ROOT, browserPort: await livePort(), sites: rows }
  },
})

TOOLS.push({
  name: 'auth_fetch',
  description: '带已保存登录态抓页面并取内容：kind=posts 时按贴吧/NGA 楼层结构提取（作者+正文），否则转纯文本；可落盘。',
  parameters: OBJ({
    site: { type: 'string', required: true },
    url: { type: 'string', required: true, description: '单个 URL；批量时用 urls' },
    urls: { type: 'array', items: { type: 'string' }, description: '批量抓取（最多 5 条，串行 + 间隔）' },
    kind: { type: 'string', enum: ['text', 'posts', 'raw', 'threads'], description: '默认 text；threads=贴吧吧列表'  },
    pages: { type: 'integer', description: '翻页数（1–20，默认 1）；贴吧用 pn=、NGA 用 page=' },
    out: { type: 'string', description: '落盘路径（可选）' },
    maxChars: { type: 'integer', description: '返回前 N 字符，默认 4000' },
  }, ['site']),
  output: OUT,
  async execute(args) {
    if (!args.url && !(Array.isArray(args.urls) && args.urls.length)) return { status: 'bad_args', hint: 'url 或 urls 至少给一个' }
    const v = await loadVault()
    const ck = v.cookies[args.site] || []
    if (!ck.length) return { status: 'no_cookie', site: args.site, hint: '先 auth_login / auth_cookie' }
    // 翻页模式：同一 URL 连续翻 N 页，楼层合并去重后连续编号
    const pages = Math.min(20, Math.max(1, Number(args.pages) || 1))
    if (pages > 1) {
      const pageParam = args.site === 'nga' ? 'page' : 'pn'
      const sep = (u) => (u.includes('?') ? '&' : '?')
      const seen = new Set()
      const merged = []
      const stats = []
      for (let i = 1; i <= pages; i++) {
        const u = args.url + sep(args.url) + pageParam + '=' + i
        try {
          let one
          if (await cdpPort()) {
            // 真浏览器带登录态取页，绕开贴吧/百度的指纹拦截
            await cdpGoto(u)
            const dom = args.kind === 'threads' ? await B.threadsFromDom() : await B.postsFromDom(args.site)
            one = { status: 200, url: u, domPosts: (dom.posts || dom.threads || []).map(x => ({ author: '', text: x.title + ' || ' + x.url })), bytes: 0 }
          } else {
            one = await fetchWith(args.site, u, ck)
          }
          const posts = one.domPosts ? one.domPosts : (args.kind === 'posts' ? extractPosts(one.text, args.site) : [])
          let added = 0
          for (const p of posts) {
            const key = String(p.text || '').slice(0, 120)
            if (!key || seen.has(key)) continue
            seen.add(key)
            merged.push({ ...p, page: i })
            added++
          }
          stats.push({ page: i, status: one.status, posts: posts.length, added })
          await audit('fetch', { site: args.site, url: safeUrl(u), status: one.status, page: i })
        } catch (e) {
          stats.push({ page: i, error: safeErr(e) })
        }
        await sleep(700)
      }
      merged.forEach((p, idx) => { p.floor = idx + 1 })
      if (args.out) {
        const { writeFile, mkdir } = await import('node:fs/promises')
        const { dirname } = await import('node:path')
        await mkdir(dirname(args.out), { recursive: true }).catch(() => {})
        await writeFile(args.out, JSON.stringify(merged, null, 1), 'utf8')
      }
      return {
        status: 'paged', site: args.site, pages, total: merged.length, stats,
        out: args.out || null,
        head: merged.slice(0, 5).map((p) => '[' + p.page + '/' + p.floor + '] ' + (p.author || '') + ' ' + String(p.text).slice(0, 120)).join(String.fromCharCode(10)),
      }
    }

    // 批量模式：串行 + 600ms 间隔，最多 5 条，防打崩站点
    if (Array.isArray(args.urls) && args.urls.length) {
      const list = args.urls.slice(0, 5)
      const results = []
      for (const u of list) {
        try {
          const one = await fetchWith(args.site, u, ck)
          const body = args.kind === 'posts' ? extractPosts(one.text, args.site)
            : args.kind === 'raw' ? one.text : toText(one.text)
          await audit('fetch', { site: args.site, url: safeUrl(u), status: one.status, batch: true })
          results.push({ url: safeUrl(u), status: one.status, bytes: one.bytes, chars: typeof body === 'string' ? body.length : body.length })
        } catch (e) {
          results.push({ url: safeUrl(u), error: safeErr(e) })
        }
        await sleep(600)
      }
      return { status: 'batch', site: args.site, count: results.length, results }
    }
    const r = await fetchWith(args.site, args.url, ck)
    await audit('fetch', { site: args.site, url: safeUrl(args.url), status: r.status })
    let payload
    if (args.kind === 'posts') payload = extractPosts(r.text, args.site)
    else if (args.kind === 'raw') payload = r.text
    else payload = toText(r.text)
    if (args.out) {
      const { writeFile, mkdir } = await import('node:fs/promises')
      const { dirname } = await import('node:path')
      await mkdir(dirname(args.out), { recursive: true }).catch(() => {})
      await writeFile(args.out, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2), 'utf8')
    }
    return {
      status: r.status, url: r.url, bytes: r.bytes, out: args.out || null,
      count: Array.isArray(payload) ? payload.length : undefined,
      head: Array.isArray(payload)
        ? payload.slice(0, 5).map((p) => `[${p.floor}] ${p.author || ''} ${p.text.slice(0, 160)}`).join('\n')
        : String(payload).slice(0, args.maxChars ?? 4000),
    }
  },
})

TOOLS.push({
  name: 'auth_vault',
  description: '本地加密凭据库（DPAPI + AES-256-GCM）：保存/查看/删除某站账号密码。「记住这个账号密码」「凭据库里都有什么」用它。不回显明文密码。',
  parameters: OBJ({
    action: { type: 'string', enum: ['set', 'list', 'forget'], required: true },
    site: { type: 'string' }, username: { type: 'string' }, password: { type: 'string' },
  }, ['action']),
  output: OUT,
  async execute(args) {
    const v = await loadVault()
    if (args.action === 'list') {
      const saved = await saveVault(v)
      return {
        vault: VAULT, encryptedWithDpapi: saved.dpapi,
        accounts: Object.entries(v.accounts).map(([k, a]) => ({ site: k, username: mask(a.username), savedAt: a.savedAt })),
        cookieSites: Object.keys(v.cookies).filter((k) => !k.endsWith('__updated')),
      }
    }
    if (!args.site) return { status: 'error', reason: '要指定 site' }
    if (args.action === 'forget') {
      delete v.accounts[args.site]; delete v.cookies[args.site]; delete v.cookies[`${args.site}__updated`]
      await saveVault(v)
      await audit('forget', { site: args.site })
    return { status: 'forgotten', site: args.site }
    }
    v.accounts[args.site] = { username: args.username || '', password: args.password || '', savedAt: new Date().toISOString() }
    const saved = await saveVault(v)
    return { status: 'saved', site: args.site, username: args.username || '', passwordStored: !!args.password, encryptedWithDpapi: saved.dpapi }
  },
})

TOOLS.push({
  name: 'auth_cookie',
  description: '手工灌 cookie（F12 抄出的 BDUSS=...; STOKEN=... 那种）。「我把 cookie 复制给你」用它。',
  parameters: OBJ({
    site: { type: 'string', required: true },
    cookie: { type: 'string', required: true, description: '"k=v; k2=v2" 形式' },
  }, ['site', 'cookie']),
  output: OUT,
  async execute(args) {
    const domain = SITES[args.site]?.domain || args.site
    const list = args.cookie.split(/;\s*/).filter(Boolean).map((kv) => {
      const i = kv.indexOf('=')
      return {
        name: i < 0 ? kv : kv.slice(0, i),
        value: i < 0 ? '' : kv.slice(i + 1),
        domain: String(domain).startsWith('.') ? domain : `.${domain}`,
        path: '/', expires: -1,
      }
    })
    const v = await loadVault()
    v.cookies[args.site] = list
    v.cookies[`${args.site}__updated`] = new Date().toISOString()
    const saved = await saveVault(v)
    return { status: 'saved', site: args.site, cookies: list.length, encryptedWithDpapi: saved.dpapi, probe: await probeSite(args.site, list) }
  },
})

// 每个工具都包一层 try/catch：插件内任何异常都不能冒到 host（否则会打断工具调用链）
function guard(tool) {
  const run = tool.execute
  return {
    ...tool,
    async execute(args, exec) {
      try {
        return await run(args, exec)
      } catch (e) {
        return { status: 'error', tool: tool.name, reason: safeErr(e) }
      }
    },
  }
}

export function apply(ctx) {
  try { installCrashHandlers() } catch {}
  try { crash('boot', { message: 'host half loaded' }) } catch {}
  for (const t of TOOLS) ctx.tools.register(guard(t))

  // 设置页的数据源：同源 /api/yunpa/*（webServer 就绪后才注册，没有也不拖垮工具层）
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], (scoped) => {
    const server = scoped.webServer
    scoped.effect(() => server.register({ kind: 'prefix', path: '/api/yunpa', handler: createApi() }),
      'yunpa: settings api')
  })
}

// ---------- Edge 密码管理器路线 ----------
import { listLogins, pickForSite, importToProfile } from './edge_creds.js'
import { tryPasswordManagerFill, fieldValues } from './edge-keyfill.js'
import { EDGE_PROFILE as CTRL_PROFILE } from './core.js'

TOOLS.push({
  name: 'auth_edge_list',
  description: '列出 Edge 密码管理器里存的站点与账号（只回显账号和密码长度，明文不出本机进程）。「Edge 里存了哪些密码」用它。',
  parameters: OBJ({
    browser: { type: 'string', enum: ['edge', 'chrome', 'brave'], description: '默认 edge' },
    profile: { type: 'string', description: '默认 Default' },
    host: { type: 'string', description: '只看某个域名片段，如 baidu' },
  }),
  output: OUT,
  async execute(args) {
    const rows = await listLogins({ browser: args.browser || 'edge', profile: args.profile || 'Default' })
    const hit = args.host ? rows.filter((r) => r.host.includes(args.host)) : rows
    const schemes = {}
    for (const r of rows) schemes[r.scheme] = (schemes[r.scheme] || 0) + 1
    return {
      total: rows.length,
      schemes,
      decryptable: rows.filter((r) => r.hasPassword).length,
      items: hit.slice(0, 40).map((r) => ({ host: r.host, username: r.username, passwordLength: r.passwordLength, scheme: r.scheme })),
    }
  },
})

TOOLS.push({
  name: 'auth_edge_import',
  description: '把 Edge 主 profile 的密码库同步进受控浏览器 profile，让 Edge 自己解密/自动填充（v20 App-Bound 只能这样用）。',
  parameters: OBJ({ browser: { type: 'string', enum: ['edge', 'chrome', 'brave'] }, profile: { type: 'string' } }),
  output: OUT,
  async execute(args) {
    const r = await importToProfile({ browser: args.browser || 'edge', profile: args.profile || 'Default', destProfile: CTRL_PROFILE })
    return { status: 'imported', dest: CTRL_PROFILE, ...r }
  },
})

TOOLS.push({
  name: 'auth_edge_login',
  description: '用 Edge 密码管理器登录站点：同步密码库 → 打开登录页 → 键盘选择第一条自动填充 → 若已填好则提交并抓 cookie。',
  parameters: OBJ({
    site: { type: 'string', required: true },
    captcha: { type: 'string', description: '需要验证码时，二次调用填这里' },
  }, ['site']),
  output: OUT,
  async execute(args) {
    const imp = await importToProfile({ browser: 'edge', profile: 'Default', destProfile: CTRL_PROFILE })
    const url = SITES[args.site]?.login || `https://${args.site}`
    const b = await launchBrowser(url)
    await goto(url)
    const fill = await tryPasswordManagerFill()
    let vals = fill.values
    if (!fill.ok && args.captcha) {
      const sub = await submitForm(args.captcha)
      await sleep(3000)
      vals = await fieldValues()
      return { status: 'retry_submitted', site: args.site, import: imp, submit: sub, values: vals }
    }
    if (!fill.ok) {
      return {
        status: 'needs_click', site: args.site, import: imp, port: b.port,
        values: vals,
        next: '自动填充没触发：在窗口里点一下账号框选第一条，或直接把密码报给模型存进凭据库',
      }
    }
    const sub = await submitForm(args.captcha || '')
    await sleep(3500)
    const got = await allCookies(b.port, SITES[args.site]?.domain || args.site)
    if (!got.length) return { status: 'login_unconfirmed', site: args.site, submit: sub }
    const v = await loadVault()
    v.cookies[args.site] = got.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires ?? -1 }))
    v.cookies[`${args.site}__updated`] = new Date().toISOString()
    await saveVault(v)
    return { status: 'logged_in', site: args.site, cookies: got.length, probe: await probeSite(args.site, v.cookies[args.site]) }
  },
})

// ---------- 我自己的浏览器 + 密码迁移 ----------
import { dumpPasswords, summary as pwSummary, exportCsv, openForManualFill, grabFilled, mask } from './pwmigrate.js'
import { CFT_EXE } from './core.js'
import { mkdir as mkdirP, stat as statP, rm as rmP } from 'node:fs/promises'
import { join as joinP } from 'node:path'
import { spawn as spawnP, execFile as execFileP } from 'node:child_process'

TOOLS.push({
  name: 'auth_browser_install',
  description: '装我自己的浏览器（Chrome for Testing，独立 profile，不碰你日常账号）。已装则直接返回路径。',
  parameters: OBJ({ force: { type: 'boolean', description: '重装，默认 false' } }),
  output: OUT,
  async execute(args) {
    const exists = await statP(CFT_EXE).then(() => true).catch(() => false)
    if (exists && !args.force) return { status: 'already', exe: CFT_EXE }
    const dir = joinP(ROOT, 'cft')
    await mkdirP(dir, { recursive: true })
    const zip = joinP(dir, 'chrome-win64.zip')
    if (!(await statP(zip).then(() => true).catch(() => false))) {
      const meta = await (await fetch('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json')).json()
      const st = meta.channels.Stable
      const url = st.downloads.chrome.find((x) => x.platform === 'win64').url
      await new Promise((res, rej) => {
        const p = spawnP('curl', ['-L', '--retry', '3', '-o', zip, url], { windowsHide: true, stdio: 'ignore' })
        p.on('close', (c) => (c === 0 ? res() : rej(new Error('下载失败 ' + c))))
      })
    }
    await new Promise((res, rej) => {
      execFileP('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`], (e) => (e ? rej(e) : res()))
    })
    const ok = await statP(CFT_EXE).then(() => true).catch(() => false)
    return { status: ok ? 'installed' : 'failed', exe: CFT_EXE }
  },
})

TOOLS.push({
  name: 'auth_dump_passwords',
  description: '把 Edge 密码管理器里的密码"转移"出来：受控浏览器打开对应登录页→触发自动填充→读 DOM 取值→存进加密库。不提交表单，明文不出本机。',
  parameters: OBJ({
    hosts: { type: 'string', description: '逗号分隔域名片段，如 baidu,qq；空=按顺序取前 limit 条' },
    limit: { type: 'integer', description: '最多处理几条，默认 3' },
    csv: { type: 'string', description: '同时导出 Chrome 可导入的 CSV 到该路径（可选）' },
  }),
  output: OUT,
  async execute(args) {
    const hosts = (args.hosts || '').split(',').map((s) => s.trim()).filter(Boolean)
    const entries = await dumpPasswords({ hosts, limit: args.limit || 3 })
    const v = await loadVault()
    let saved = 0
    for (const e of entries) {
      if (!e.ok || !e.password) continue
      v.accounts[e.host] = { username: e.username || '', password: e.password, savedAt: new Date().toISOString(), source: 'edge-pwm' }
      saved++
    }
    const encrypted = await saveVault(v)
    let csvInfo = null
    if (args.csv) csvInfo = await exportCsv(entries, args.csv)
    return { status: 'done', saved, encrypted: encrypted.dpapi, results: pwSummary(entries), csv: csvInfo }
  },
})

TOOLS.push({
  name: 'auth_export_csv',
  description: '把已存凭据导出成 Chrome 可导入的 passwords.csv（在你自己的浏览器里设置→密码→导入）。',
  parameters: OBJ({ out: { type: 'string', description: '落盘路径，默认 .dsh-login/passwords.csv' } }),
  output: OUT,
  async execute(args) {
    const v = await loadVault()
    const rows = Object.entries(v.accounts).filter(([, a]) => a.password)
    const esc = (x) => '"' + String(x || '').replace(/"/g, '""') + '"'
    const lines = ['name,url,username,password']
    for (const [host, a] of rows) lines.push([esc(host), esc('https://' + host), esc(a.username), esc(a.password)].join(','))
    const out = args.out || ROOT + '/exports/passwords.csv'
    await mkdirP(ROOT + '/exports', { recursive: true }).catch(() => {})
    const { writeFile: wf } = await import('node:fs/promises')
    await wf(out, lines.join('\n'), 'utf8')
    return { status: 'exported', file: out, rows: rows.length }
  },
})

TOOLS.push({
  name: 'auth_pw_open',
  description: '用受控 Edge（已同步你的密码库）打开某站的登录页，留给你点一下自动填充建议。',
  parameters: OBJ({ origin: { type: 'string', required: true, description: '完整登录页 URL' } }, ['origin']),
  output: OUT,
  async execute(args) { return openForManualFill(args.origin) },
})

TOOLS.push({
  name: 'auth_pw_grab',
  description: '把当前受控窗口里已被自动填充的账号密码读出来，存进加密库（可顺带导出 Chrome 可导入的 CSV）。',
  parameters: OBJ({
    site: { type: 'string', description: '存到哪个站点键，默认用当前页 host' },
    csv: { type: 'string', description: '同时导出 CSV 路径（可选）' },
    waitSec: { type: 'integer', description: '最多等多少秒等你点自动填充，默认 0=不等待' },
  }),
  output: OUT,
  async execute(args) {
    // 轮询等待：你点完自动填充后自动落库，不用再喊一次
    let filled = await grabFilled()
    const deadline = Date.now() + Math.max(0, args.waitSec || 0) * 1000
    while ((!filled || !filled.password) && Date.now() < deadline) {
      await sleep(1500)
      filled = await grabFilled()
    }
    if (!filled) return { status: 'empty', hint: '窗口里还没有填充值' }
    if (!filled.password) return { status: 'no_password', filled: { host: filled.host, username: mask(filled.username) }, hint: '先把自动填充建议点上去' }
    const key = args.site || filled.host
    const v = await loadVault()
    v.accounts[key] = { username: filled.username, password: filled.password, savedAt: new Date().toISOString(), source: 'edge-pw-click' }
    const enc = await saveVault(v)
    let csvInfo = null
    if (args.csv) csvInfo = await exportCsv([{ host: filled.host, origin: filled.url, username: filled.username, password: filled.password, ok: true }], args.csv)
    return { status: 'saved', site: key, username: mask(filled.username), passwordLen: filled.password.length, encrypted: enc.dpapi, csv: csvInfo }
  },
})

// ---------- browser_* 层（照 companion 骨架，动作全部走快照编号 ref） ----------
import * as B from './browser.js'
import { goto as cdpGoto, livePort as cdpPort } from './core.js'
import { createApi } from './api.js'

const TOGGLES = { open: '浏览器没开时自动拉起可见窗口' }

TOOLS.push({
  name: 'browser_open',
  description: '打开页面（可见窗口，持久 profile，保留登录态）。companion 语义：先开→Snapshot→按 ref 操作。',
  parameters: OBJ({ url: { type: 'string', required: true } }, ['url']),
  output: OUT,
  async execute(args) {
    const b = await launchBrowser(args.url)
    const page = await goto(args.url).catch((e) => ({ error: String(e.message || e) }))
    return { port: b.port, reused: b.reused, page }
  },
})

TOOLS.push({
  name: 'browser_snapshot',
  description: '取页面结构快照：标题/URL/正文 + 可交互元素编号（ref=e0…），后续 click/type 用 ref 定位。密码框值永远显示 ••••。',
  parameters: OBJ({
    maxText: { type: 'integer', description: '正文截断长度，默认 6000' },
    maxElements: { type: 'integer', description: '元素上限，默认 120' },
  }),
  output: OUT,
  async execute(args) { return B.snapshot({ maxText: args.maxText, maxElements: args.maxElements }) },
})

TOOLS.push({
  name: 'browser_click',
  description: '按快照里的 ref 点击元素（链接/按钮/复选框）。',
  parameters: OBJ({ ref: { type: 'string', required: true, description: '如 e3' } }, ['ref']),
  output: OUT,
  async execute(args) { return B.click(args.ref) },
})

TOOLS.push({
  name: 'browser_type',
  description: '按 ref 输入文本。密码框默认拒填（返回 password-field-refused），要填密码走 auth_fill_from_vault。',
  parameters: OBJ({
    ref: { type: 'string', required: true },
    text: { type: 'string', required: true },
    allowPassword: { type: 'boolean', description: '仅调试用，默认 false' },
  }, ['ref', 'text']),
  output: OUT,
  async execute(args) { return B.typeInto(args.ref, args.text, { allowPassword: !!args.allowPassword }) },
})

TOOLS.push({
  name: 'browser_press',
  description: '按键：Enter / Tab / Escape / ArrowDown / ArrowUp / Backspace。',
  parameters: OBJ({ key: { type: 'string', required: true } }, ['key']),
  output: OUT,
  async execute(args) { return B.press(args.key) },
})

TOOLS.push({
  name: 'browser_scroll',
  description: '滚动：up / down / top / bottom。',
  parameters: OBJ({ dir: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] } }),
  output: OUT,
  async execute(args) { return B.scroll(args.dir || 'down') },
})

TOOLS.push({
  name: 'browser_get_text',
  description: '读正文（可指定 CSS 选择器），最长 8000 字。',
  parameters: OBJ({ selector: { type: 'string', description: '可选，如 .d_post_content' } }),
  output: OUT,
  async execute(args) { return B.getText(args.selector) },
})

TOOLS.push({
  name: 'browser_meta',
  description: '当前页标题与 URL。',
  parameters: OBJ({}),
  output: OUT,
  async execute() { return B.meta() },
})

TOOLS.push({
  name: 'browser_screenshot',
  description: '截图存文件（默认 .dsh-login/page.png）。',
  parameters: OBJ({ out: { type: 'string' } }),
  output: OUT,
  async execute(args) { return B.screenshot(args.out) },
})

TOOLS.push({
  name: 'browser_tabs',
  description: '列出所有标签页（id/标题/URL）。',
  parameters: OBJ({}),
  output: OUT,
  async execute() { return B.tabs() },
})

TOOLS.push({
  name: 'browser_new_tab',
  description: '新开一个标签页并导航到指定 URL（不影响当前页的登录态）。',
  parameters: OBJ({ url: { type: 'string', required: true } }, ['url']),
  output: OUT,
  async execute(args) { return B.newTab(args.url) },
})

TOOLS.push({
  name: 'browser_close_tab',
  description: '关闭指定标签页（用 browser_tabs 拿到的 id）。',
  parameters: OBJ({ id: { type: 'string', required: true } }, ['id']),
  output: OUT,
  async execute(args) { return B.closeTab(args.id) },
})

TOOLS.push({
  name: 'browser_wait',
  description: '等条件满足：selector 出现 / url 包含 / 某站登录 cookie 就位。比 sleep 稳。',
  parameters: OBJ({
    selector: { type: 'string' },
    urlIncludes: { type: 'string' },
    cookieSite: { type: 'string', description: '如 tieba：检测 BDUSS 是否就位' },
    timeoutMs: { type: 'integer', description: '默认 20000' },
  }),
  output: OUT,
  async execute(args) { return B.waitFor({ selector: args.selector, urlIncludes: args.urlIncludes, cookieSite: args.cookieSite, timeoutMs: args.timeoutMs }) },
})

TOOLS.push({
  name: 'browser_wait_login',
  description: 'companion 同名的登录判定：等某站登录 cookie 出现（贴吧认 BDUSS），别用固定 sleep 猜。',
  parameters: OBJ({
    site: { type: 'string', required: true },
    timeoutMs: { type: 'integer' },
  }, ['site']),
  output: OUT,
  async execute(args) { return B.waitFor({ cookieSite: args.site, timeoutMs: args.timeoutMs || 120000 }) },
})

TOOLS.push({
  name: 'auth_fill_from_vault',
  description: '把加密库里的账号密码填进当前页表单（ref 可选，缺省自动找账号/密码框）。这是对 companion「拒填密码」的补：凭据只从本地加密库出，明文不进对话。',
  parameters: OBJ({
    site: { type: 'string', required: true, description: '凭据库里的站点键' },
    userRef: { type: 'string', description: '账号框 ref（可选）' },
    passRef: { type: 'string', description: '密码框 ref（可选）' },
    submit: { type: 'boolean', description: '填完是否按 Enter 提交，默认 false' },
  }, ['site']),
  output: OUT,
  async execute(args) {
    const v = await loadVault()
    const acc = v.accounts[args.site]
    if (!acc?.username) return { status: 'no_credentials', site: args.site, hint: '先 auth_vault set' }
    let uRef = args.userRef
    let pRef = args.passRef
    if (!uRef || !pRef) {
      const snap = await B.snapshot({ maxText: 200, maxElements: 200 })
      const els = snap.elements || []
      const pw = els.find((e) => e.kind === 'input:password')
      const user = els.find((e) => ['input:text', 'input:email', 'input:tel', 'input:'].includes(e.kind))
      uRef = uRef || user?.ref
      pRef = pRef || pw?.ref
    }
    if (!uRef || !pRef) return { status: 'no_fields', site: args.site, userRef: uRef || null, passRef: pRef || null }
    const u = await B.typeInto(uRef, acc.username)
    const p = await B.typeInto(pRef, acc.password, { allowPassword: true })
    let submit = null
    if (args.submit) submit = await B.press('Enter')
    return { status: 'filled', site: args.site, user: u, pass: { ok: p.ok, len: p.len }, submit }
  },
})
