// dsh-yunpa v0.2.0 · 登录态插件（Host 半身）
// 加密凭据库(DPAPI) + 受控浏览器(Edge/CDP，单例) + 自动填表 + 验证码交图 + 带登录态抓取/楼层提取
import {
  SITES, ROOT, VAULT, loadVault, saveVault, launchBrowser, closeBrowser, livePort,
  allCookies, autofill, submitForm, captchaTo, goto, fetchWith, probeSite, clearBrowserCookies, audit, safeErr, safeUrl, crash, installCrashHandlers,
  extractPosts, toText, sleep,
} from './core.js'
import { pickElement, collectPage } from './capture.js'

export const name = 'yunpa'
export const inject = ['tools']

// render 契约是 (args, value)：只收一个参数会把「参数」当结果显示，等于回显入参。
// 2026-11-14 修：任何返回对象（browser_meta / auth_status / auth_fetch…）之前都显示成入参或 {}。
function textOut() {
  const v = arguments.length > 1 ? arguments[1] : arguments[0]
  return [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }]
}
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
  description: '登录完成后把受控浏览器里该站点的 cookie 抓进加密凭据库；close/wipeProfile 可关窗、清 profile，返回登录态探测结果。',
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
  description: '列凭据库里每个站点的 cookie 数、账号、剩余有效天数和受控浏览器端口；probe=false 跳过真实请求探测。',
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
  description: '带登录态抓页面：kind=text/posts/raw/threads 决定提取方式；pages>1 自动翻页合并去重并编号楼层；urls 批量最多 5 条；out 落盘。',
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
      // 之前写成 count: Array.isArray(payload) ? payload.length : undefined，
      // undefined 会让宿主的无损 JSON 校验拒掉整个工具结果（2026-11-14 修）
      count: Array.isArray(payload) ? payload.length : (typeof payload === 'string' ? payload.length : null),
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

// ── 元素拾取与滚动采集（capture.js）─────────────────────────────
TOOLS.push({
  name: 'browser_pick',
  description: '让用户在页面上点一个元素，返回 selector / HTML / 尺寸 / 同类数量。定抓取规则时用它，别猜 DOM。',
  parameters: OBJ({
    timeoutMs: { type: 'number' },
  }, []),
  output: OUT,
  async execute(args) {
    return pickElement({ timeoutMs: args.timeoutMs })
  },
})

TOOLS.push({
  name: 'browser_collect',
  description: '滚动到底采集全文：反复滚屏直到没有新内容（懒加载长页用它）；selector 只取某容器；assert 当场断言 minLength/contains。',
  parameters: OBJ({
    selector: { type: 'string' },
    maxScroll: { type: 'number' },
    waitMs: { type: 'number' },
    assert: { type: 'object', additionalProperties: true },
  }, []),
  output: OUT,
  async execute(args) {
    return collectPage(args)
  },
})

// ── 参数级描述（2026-11-14 从 index.js.bak-desc 提回，路径类已按现值校正）──
// 只在字段缺 description 时补，不覆盖工具定义里已有的；重复 apply 幂等。
export const PARAM_DESC = {
  auth_login: {
    site: '站点键：tieba / nga / pixiv / alicesw，或任意域名',
    mode: 'browser=开可见窗口人工登录；form=用凭据库自动填表',
    captcha: 'form 模式第一次返回 needs_captcha 后，把用户报的验证码填这里再调一次',
    captchaOut: '验证码图落盘路径，默认 ~/.dsh/private/yunpa/shots/captcha-<时间戳>.png',
  },
  auth_captcha: {
    out: '验证码图落盘路径，默认 ~/.dsh/private/yunpa/shots/captcha-<时间戳>.png',
  },
  auth_capture: {
    site: '站点键或域名',
    close: '抓完是否关掉浏览器，默认 false',
    wipeProfile: '抓完清掉受控 profile 里的 cookie，只留加密库那份，默认 false',
  },
  auth_status: {
    probe: '是否真的发请求探测，默认 true',
  },
  auth_fetch: {
    site: '站点键，决定用哪份 cookie',
    url: '单个 URL；批量时改用 urls',
    urls: '批量抓取（最多 5 条，串行 + 间隔）',
    kind: '默认 text；posts=按站点提楼层；raw=原始 HTML；threads=贴吧吧列表',
    pages: '翻页数（1–20，默认 1）；贴吧用 pn=、NGA 用 page=',
    out: '落盘路径（可选）',
    maxChars: '返回前 N 字符，默认 4000',
  },
  auth_vault: {
    action: 'set=存账号密码 / list=列已存站点 / forget=删掉该站点',
    site: '站点键',
    username: '账号（set 时用）',
    password: '密码（set 时用，不回显）',
  },
  auth_cookie: {
    site: '站点键',
    cookie: '"k=v; k2=v2" 形式',
  },
  auth_edge_list: {
    browser: '默认 edge',
    profile: '默认 Default',
    host: '只看某个域名片段，如 baidu',
  },
  auth_edge_import: {
    browser: '默认 edge',
    profile: '默认 Default',
  },
  auth_edge_login: {
    site: '站点键',
    captcha: '自动填充没触发时，第二次调用带上验证码提交表单',
  },
  auth_browser_install: {
    force: '重装，默认 false',
  },
  auth_dump_passwords: {
    hosts: '逗号分隔域名片段，如 baidu,qq；空=按顺序取前 limit 条',
    limit: '最多处理几条，默认 3',
    csv: '同时导出 Chrome 可导入的 CSV 到该路径（可选）',
  },
  auth_export_csv: {
    out: '落盘路径，默认 ~/.dsh/private/yunpa/exports/passwords.csv',
  },
  auth_pw_open: {
    origin: '完整登录页 URL',
  },
  auth_pw_grab: {
    site: '存到哪个站点键，默认用当前页 host',
    csv: '同时导出 CSV 路径（可选）',
    waitSec: '最多等多少秒等你点自动填充，默认 0=不等待',
  },
  auth_fill_from_vault: {
    site: '凭据库里的站点键',
    userRef: '账号框 ref（可选，不给就按快照自动找）',
    passRef: '密码框 ref（可选，不给就按快照自动找）',
    submit: '填完是否按 Enter 提交，默认 false',
  },
  browser_open: {
    url: '要打开的地址',
  },
  browser_snapshot: {
    maxText: '正文截断长度，默认 6000',
    maxElements: '元素上限，默认 120',
  },
  browser_click: {
    ref: '如 e3，来自 browser_snapshot',
  },
  browser_type: {
    ref: '如 e3，来自 browser_snapshot',
    text: '要填的文本',
    allowPassword: '密码框默认拒填，仅调试时置 true',
  },
  browser_scroll: {
    dir: '默认 down：up/down 滚一屏，top/bottom 到顶到底',
  },
  browser_press: {
    key: 'Enter / Tab / Escape / ArrowUp / ArrowDown / Backspace',
  },
  browser_eval: {
    expression: '要执行的 JS，支持 await（如 (async()=>{const r=await fetch("/x/player/wbi/v2?...",{credentials:"include"});return r.json()})()）',
    timeoutMs: '超时毫秒，默认 15000，上限 60000',
    maxChars: '返回文本截断长度，默认 8000',
  },
  browser_get_text: {
    selector: '可选，如 .d_post_content',
  },
  browser_screenshot: {
    out: 'PNG 落盘路径，默认 ~/.dsh/private/yunpa/shots/page-<时间戳>.png',
  },
  browser_new_tab: {
    url: '新标签页地址',
  },
  browser_close_tab: {
    id: '来自 browser_tabs 的 id',
  },
  browser_wait: {
    selector: '等某元素出现',
    urlIncludes: '等 URL 含指定片段',
    cookieSite: '如 tieba：检测 BDUSS 是否就位',
    timeoutMs: '默认 20000',
  },
  browser_wait_login: {
    site: '站点键，检测该站登录 cookie 是否就位',
    timeoutMs: '默认 120000',
  },
  browser_pick: {
    timeoutMs: '等用户点选的超时毫秒数',
  },
  browser_collect: {
    selector: '只取某容器（可选，默认整页）',
    maxScroll: '最多滚几次',
    waitMs: '每次滚动后等待毫秒数',
    assert: '当场断言，如 { minLength: 500, contains: "关键词" }',
  },
}

function withParamDesc(tool) {
  const map = PARAM_DESC[tool.name]
  const props = tool && tool.parameters && tool.parameters.properties
  if (!map || !props) return tool
  for (const [field, text] of Object.entries(map)) {
    const spec = props[field]
    // 表即真相：表里有就以表为准，避免字面量里的旧文案（如过时路径）残留
    if (spec && typeof spec === 'object') spec.description = text
  }
  return tool
}

// 宿主要求工具结果无损 JSON：undefined 会让整条结果被判 "value is not lossless JSON" 而丢掉。
// 可选参数没传时返回对象里很容易漏 undefined（browser_wait / auth_fetch 都踩过），这里统一兜底。
function sanitizeJson(v) {
  if (v === undefined) return null
  if (v === null) return v
  const t = typeof v
  if (t === 'number') return Number.isFinite(v) ? v : null
  if (t !== 'object') return t === 'function' || t === 'symbol' || t === 'bigint' ? null : v
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(sanitizeJson)
  const out = {}
  for (const [k, x] of Object.entries(v)) out[k] = sanitizeJson(x)
  return out
}

// 每个工具都包一层 try/catch：插件内任何异常都不能冒到 host（否则会打断工具调用链）
function guard(tool) {
  const run = tool.execute
  return {
    ...tool,
    async execute(args, exec) {
      try {
        return sanitizeJson(await run(args, exec))
      } catch (e) {
        return { status: 'error', tool: tool.name, reason: safeErr(e) }
      }
    },
  }
}

export function apply(ctx) {
  try { installCrashHandlers() } catch {}
  try { crash('boot', { message: 'host half loaded' }) } catch {}
  for (const t of TOOLS) ctx.tools.register(guard(withParamDesc(t)))

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
  description: '把 Edge/Chrome/Brave 密码库里的登录数据导进受控浏览器 profile（凭据留在本地库，不回显明文）。',
  parameters: OBJ({ browser: { type: 'string', enum: ['edge', 'chrome', 'brave'] }, profile: { type: 'string' } }),
  output: OUT,
  async execute(args) {
    const r = await importToProfile({ browser: args.browser || 'edge', profile: args.profile || 'Default', destProfile: CTRL_PROFILE })
    return { status: 'imported', dest: CTRL_PROFILE, ...r }
  },
})

TOOLS.push({
  name: 'auth_edge_login',
  description: '先从 Edge 密码库导入该站点凭据，再打开登录页触发自动填充；填充没触发时带 captcha 提交表单重试。',
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
  description: '按 hosts 从 Edge 密码库逐站取出账号密码（用 Edge 自身解锁 v20，逐页自动填充读 DOM，默认只取 3 条），写入加密凭据库，csv 可另存。',
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
  description: '把凭据库里所有带密码的账号导出成 CSV，默认落 .dsh/private/yunpa/exports/passwords.csv（明文文件，注意存放位置）。',
  parameters: OBJ({ out: { type: 'string', description: '落盘路径，默认 ~/.dsh/private/yunpa/exports/passwords.csv' } }),
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
  description: '在受控浏览器打开指定登录页，等你手动点浏览器的自动填充建议；填充后用 auth_pw_grab 取回密码。',
  parameters: OBJ({ origin: { type: 'string', required: true, description: '完整登录页 URL' } }, ['origin']),
  output: OUT,
  async execute(args) { return openForManualFill(args.origin) },
})

TOOLS.push({
  name: 'auth_pw_grab',
  description: '读取当前窗口自动填充后写进表单的账号密码并存库；waitSec 可轮询等你手动点填充，csv 可顺带导出。',
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
  description: '打开（或复用）受控可见浏览器并跳转到 url，返回调试端口与是否复用。',
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
  description: '快照当前页：标题、正文文本与可交互元素编号 ref（后续 click/type 都用这些 ref）。',
  parameters: OBJ({
    maxText: { type: 'integer' },
    maxElements: { type: 'integer' },
  }),
  output: OUT,
  async execute(args) { return B.snapshot({ maxText: args.maxText, maxElements: args.maxElements }) },
})

TOOLS.push({
  name: 'browser_click',
  description: '点击 browser_snapshot 给出的 ref 元素；ref 失效时先重拍快照。',
  parameters: OBJ({ ref: { type: 'string', required: true, description: '如 e3' } }, ['ref']),
  output: OUT,
  async execute(args) { return B.click(args.ref) },
})

TOOLS.push({
  name: 'browser_type',
  description: '往 ref 元素填文本；密码框默认拒填，确需填写带 allowPassword，正规做法是 auth_fill_from_vault。',
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
  description: '滚动当前页：up/down 滚一屏，top/bottom 到顶到底，返回当前滚动位置。',
  parameters: OBJ({ dir: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] } }),
  output: OUT,
  async execute(args) { return B.scroll(args.dir || 'down') },
})

TOOLS.push({
  name: 'browser_get_text',
  description: '取当前页纯文本，给 selector 就只取该容器的 innerText，最多 8000 字。',
  parameters: OBJ({ selector: { type: 'string', description: '可选，如 .d_post_content' } }),
  output: OUT,
  async execute(args) { return B.getText(args.selector) },
})

TOOLS.push({
  name: 'browser_meta',
  description: '返回当前页的标题与 URL。',
  parameters: OBJ({}),
  output: OUT,
  async execute() { return B.meta() },
})

TOOLS.push({
  name: 'browser_eval',
  description: '在受控浏览器当前页执行 JS 表达式（支持 await），返回 JSON 文本。页面内 fetch 自带指纹 cookie，可绕开 412 与 wbi 签名——读 __INITIAL_STATE__ / __playinfo__ / 页面内接口都走它。',
  parameters: OBJ({
    expression: { type: 'string', required: true },
    timeoutMs: { type: 'number' },
    maxChars: { type: 'integer' },
  }, ['expression']),
  output: OUT,
  async execute(args) { return B.evaluate(args.expression, { timeoutMs: args.timeoutMs, maxChars: args.maxChars }) },
})

TOOLS.push({
  name: 'browser_screenshot',
  description: '当前页截 PNG 存文件，默认落 .dsh/private/yunpa/shots/page-*.png。',
  parameters: OBJ({ out: { type: 'string' } }),
  output: OUT,
  async execute(args) { return B.screenshot(args.out) },
})

TOOLS.push({
  name: 'browser_tabs',
  description: '列出受控浏览器的所有标签页 id/标题/URL，关闭标签页时用它的 id。',
  parameters: OBJ({}),
  output: OUT,
  async execute() { return B.tabs() },
})

TOOLS.push({
  name: 'browser_new_tab',
  description: '新开一个标签页并打开 url；浏览器没在跑会自动拉起。',
  parameters: OBJ({ url: { type: 'string', required: true } }, ['url']),
  output: OUT,
  async execute(args) { return B.newTab(args.url) },
})

TOOLS.push({
  name: 'browser_close_tab',
  description: '按 browser_tabs 返回的 id 关闭标签页。',
  parameters: OBJ({ id: { type: 'string', required: true } }, ['id']),
  output: OUT,
  async execute(args) { return B.closeTab(args.id) },
})

TOOLS.push({
  name: 'browser_wait',
  description: '轮询等待条件成立：selector 出现、URL 含某串或指定站点 cookie 到位，默认 20 秒。',
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
  description: '等指定站点的登录态 cookie 出现，默认 120 秒；人工登录完用它卡住后续抓取。',
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
