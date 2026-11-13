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
  description: '登录站点：browser=开窗人工过验证码；form=用凭据库自动填表，需验证码时带 captcha 重调。',
  parameters: OBJ({
    site: { type: 'string', required: true },
    mode: { type: 'string', enum: ['browser', 'form'], required: true },
    captcha: { type: 'string' },
    captchaOut: { type: 'string' },
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
  description: '当前页验证码截图存文件，供用户报码。',
  parameters: OBJ({
    out: { type: 'string' },
  }),
  output: OUT,
  async execute(args) {
    return captchaTo(args.out || ROOT + '/shots/captcha-' + Date.now() + '.png')
  },
})

TOOLS.push({
  name: 'auth_capture',
  parameters: OBJ({
    site: { type: 'string', required: true },
    close: { type: 'boolean' },
    wipeProfile: { type: 'boolean' },
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
  description: '关闭受控浏览器。',
  parameters: OBJ({}),
  output: OUT,
  async execute() { return closeBrowser() },
})

TOOLS.push({
  name: 'auth_status',
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
  parameters: OBJ({
    site: { type: 'string', required: true },
    url: { type: 'string', required: true },
    urls: { type: 'array', items: { type: 'string' } },
    kind: { type: 'string', enum: ['text', 'posts', 'raw', 'threads']  },
    pages: { type: 'integer' },
    out: { type: 'string' },
    maxChars: { type: 'integer' },
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
  description: '加密凭据库：action=set/list/forget。不回显明文密码。',
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
  description: '手工灌 cookie（F12 抄出的 BDUSS=…;STOKEN=…）。',
  parameters: OBJ({
    site: { type: 'string', required: true },
    cookie: { type: 'string', required: true },
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
  description: '列 Edge 密码库里的站点与账号（只回显账号与密码长度）。',
  parameters: OBJ({
    browser: { type: 'string', enum: ['edge', 'chrome', 'brave'] },
    profile: { type: 'string' },
    host: { type: 'string' },
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
  parameters: OBJ({ browser: { type: 'string', enum: ['edge', 'chrome', 'brave'] }, profile: { type: 'string' } }),
  output: OUT,
  async execute(args) {
    const r = await importToProfile({ browser: args.browser || 'edge', profile: args.profile || 'Default', destProfile: CTRL_PROFILE })
    return { status: 'imported', dest: CTRL_PROFILE, ...r }
  },
})

TOOLS.push({
  name: 'auth_edge_login',
  parameters: OBJ({
    site: { type: 'string', required: true },
    captcha: { type: 'string' },
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
  description: '安装自带 Chrome for Testing（独立 profile）。',
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
  parameters: OBJ({
    hosts: { type: 'string' },
    limit: { type: 'integer' },
    csv: { type: 'string' },
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
  parameters: OBJ({ origin: { type: 'string', required: true, description: '完整登录页 URL' } }, ['origin']),
  output: OUT,
  async execute(args) { return openForManualFill(args.origin) },
})

TOOLS.push({
  name: 'auth_pw_grab',
  parameters: OBJ({
    site: { type: 'string' },
    csv: { type: 'string' },
    waitSec: { type: 'integer' },
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
  parameters: OBJ({
    maxText: { type: 'integer' },
    maxElements: { type: 'integer' },
  }),
  output: OUT,
  async execute(args) { return B.snapshot({ maxText: args.maxText, maxElements: args.maxElements }) },
})

TOOLS.push({
  name: 'browser_click',
  parameters: OBJ({ ref: { type: 'string', required: true, description: '如 e3' } }, ['ref']),
  output: OUT,
  async execute(args) { return B.click(args.ref) },
})

TOOLS.push({
  name: 'browser_type',
  parameters: OBJ({
    ref: { type: 'string', required: true },
    text: { type: 'string', required: true },
    allowPassword: { type: 'boolean' },
  }, ['ref', 'text']),
  output: OUT,
  async execute(args) { return B.typeInto(args.ref, args.text, { allowPassword: !!args.allowPassword }) },
})

TOOLS.push({
  name: 'browser_press',
  description: '按键：Enter/Tab/Escape/ArrowUp/ArrowDown/Backspace。',
  parameters: OBJ({ key: { type: 'string', required: true } }, ['key']),
  output: OUT,
  async execute(args) { return B.press(args.key) },
})

TOOLS.push({
  name: 'browser_scroll',
  parameters: OBJ({ dir: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] } }),
  output: OUT,
  async execute(args) { return B.scroll(args.dir || 'down') },
})

TOOLS.push({
  name: 'browser_get_text',
  parameters: OBJ({ selector: { type: 'string', description: '可选，如 .d_post_content' } }),
  output: OUT,
  async execute(args) { return B.getText(args.selector) },
})

TOOLS.push({
  name: 'browser_meta',
  parameters: OBJ({}),
  output: OUT,
  async execute() { return B.meta() },
})

TOOLS.push({
  name: 'browser_screenshot',
  parameters: OBJ({ out: { type: 'string' } }),
  output: OUT,
  async execute(args) { return B.screenshot(args.out) },
})

TOOLS.push({
  name: 'browser_tabs',
  parameters: OBJ({}),
  output: OUT,
  async execute() { return B.tabs() },
})

TOOLS.push({
  name: 'browser_new_tab',
  parameters: OBJ({ url: { type: 'string', required: true } }, ['url']),
  output: OUT,
  async execute(args) { return B.newTab(args.url) },
})

TOOLS.push({
  name: 'browser_close_tab',
  parameters: OBJ({ id: { type: 'string', required: true } }, ['id']),
  output: OUT,
  async execute(args) { return B.closeTab(args.id) },
})

TOOLS.push({
  name: 'browser_wait',
  parameters: OBJ({
    selector: { type: 'string' },
    urlIncludes: { type: 'string' },
    cookieSite: { type: 'string' },
    timeoutMs: { type: 'integer' },
  }),
  output: OUT,
  async execute(args) { return B.waitFor({ selector: args.selector, urlIncludes: args.urlIncludes, cookieSite: args.cookieSite, timeoutMs: args.timeoutMs }) },
})

TOOLS.push({
  name: 'browser_wait_login',
  parameters: OBJ({
    site: { type: 'string', required: true },
    timeoutMs: { type: 'integer' },
  }, ['site']),
  output: OUT,
  async execute(args) { return B.waitFor({ cookieSite: args.site, timeoutMs: args.timeoutMs || 120000 }) },
})

TOOLS.push({
  name: 'auth_fill_from_vault',
  description: '把库里的账号密码填进当前页表单（ref 可选）。',
  parameters: OBJ({
    site: { type: 'string', required: true },
    userRef: { type: 'string' },
    passRef: { type: 'string' },
    submit: { type: 'boolean' },
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
