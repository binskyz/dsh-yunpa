// core.js · dsh-yunpa 内核：DPAPI 加密凭据库 / 受控浏览器(CDP) / 带登录态抓取 / 楼层提取
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile, stat, rm, appendFile } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const HOME = homedir()
export const ROOT = join(HOME, '.dsh', 'private', 'yunpa')
export const VAULT = join(ROOT, 'vault.bin')
export const KEYFILE = join(ROOT, 'key.bin')
export const EDGE_PROFILE = join(ROOT, 'edge-profile')
export const PORTFILE = join(ROOT, 'cdp-port.txt')
// 我自己的浏览器优先：Chrome for Testing（自带 profile，不碰用户日常账号）
export const CFT_EXE = join(ROOT, 'cft', 'chrome-win64', 'chrome.exe')
// 无窗口运行用 headless-shell（~100MB），要人工登录时才回落到完整 CFT 窗口
export const HS_EXE = join(ROOT, 'hs', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
export const HS_VERSION_FILE = join(ROOT, 'hs', 'version.txt')
// 只有后台服务会用的 Google 端点：拦掉它们不影响任何正常站点
export const BLOCKED_HOSTS = [
  'update.googleapis.com',
  'clients2.google.com',
  'clients2.googleusercontent.com',
  'chromewebstore.googleapis.com',
  'www.google.com',
  'google.com',
  'accounts.google.com',
  'safebrowsing.googleapis.com',
  'optimizationguide-pa.googleapis.com',
  'www.gstatic.com',
  'ssl.gstatic.com',
]
export const EDGE_EXE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
let forcedExe = null
let forcedProfile = null
export function setBrowserExe(p) { forcedExe = p }
export function setProfileDir(p) { forcedProfile = p }
export function activeProfile() { return forcedProfile || EDGE_PROFILE }
export const BROWSER_CANDIDATES = [
  HS_EXE,
  CFT_EXE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
export const PORTS = [9333, 9334, 9335, 9336]
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BUILTIN_SITES = {
  tieba: {
    domain: '.baidu.com',
    login: 'https://passport.baidu.com/v2/?login',
    probe: 'https://tieba.baidu.com/',
    marker: '我的贴吧',
  },
  nga: {
    domain: 'nga.cn',
    login: 'https://bbs.nga.cn/nuke.php?func=login',
    probe: 'https://bbs.nga.cn/read.php?tid=33739719',
    marker: '访客不能直接访问',
    markerMeansLoggedOut: true,
  },
  pixiv: {
    domain: '.pixiv.net',
    login: 'https://accounts.pixiv.net/login.php',
    probe: 'https://www.pixiv.net/novel/series/13832008',
    marker: '示例书目',
  },
  alicesw: {
    domain: 'alicesw.com',
    login: 'https://www.alicesw.com/user/user/login.html',
    probe: 'https://www.alicesw.com/',
    marker: '示例作者',
  },
}

/** 站点表：内置默认 + 数据目录 sites.json 覆盖（用户可加站，不改代码） */
export function loadSites() {
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, 'sites.json'), 'utf8'))
    return { ...BUILTIN_SITES, ...raw }
  } catch { return { ...BUILTIN_SITES } }
}

export const SITES = loadSites()

/** 写回 sites.json（设置页加站点用） */
export async function saveSites(next) {
  await mkdir(ROOT, { recursive: true })
  await writeFile(join(ROOT, 'sites.json'), JSON.stringify(next, null, 2))
  for (const k of Object.keys(SITES)) delete SITES[k]
  Object.assign(SITES, next)
  return Object.keys(next)
}

// ---------- PowerShell / DPAPI ----------

export function runPS(script, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    let out = '', err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `ps exit ${code}`))))
    setTimeout(() => { try { p.kill() } catch {} }, timeout)
  })
}

export async function dpapi(buf, mode) {
  const b64 = buf.toString('base64')
  const fn = mode === 'protect' ? 'Protect' : 'Unprotect'
  const script = `Add-Type -AssemblyName System.Security;` +
    `$b=[Convert]::FromBase64String('${b64}');` +
    `$r=[Security.Cryptography.ProtectedData]::${fn}($b,$null,'CurrentUser');` +
    `[Convert]::ToBase64String($r)`
  const out = await runPS(script)
  return Buffer.from(out, 'base64')
}

export async function ensureRoot() {
  await mkdir(ROOT, { recursive: true })
  // 只补"当前用户完全控制"，绝不先断继承（断继承曾导致子目录失去 ACE、浏览器 EPERM）
  try {
    const domain = process.env.USERDOMAIN
    const user = process.env.USERNAME
    const principal = domain && user ? domain + String.fromCharCode(92) + user : (user || "")
    if (principal) spawn("icacls", [ROOT, "/grant:r", principal + ":(OI)(CI)F"], { windowsHide: true }).unref()
  } catch {}
}

/** 清理历史残留：调试日志、测试 profile、过期截图（每次进程启动跑一次） */
let cleaned = false
export async function cleanupArtifacts() {
  if (cleaned) return
  cleaned = true
  const { readdir, rm } = await import('node:fs/promises')
  for (const name of await readdir(ROOT).catch(() => [])) {
    if ((name.startsWith("netlog") && name.endsWith(".json")) || name.startsWith("eg-") || name.startsWith("nl-") || name === "netlog-profile") {
      await rm(join(ROOT, name), { recursive: true, force: true }).catch(() => {})
    }
  }
  const shots = join(ROOT, 'shots')
  const files = await readdir(shots).catch(() => [])
  if (files.length > 20) for (const f of files.slice(0, files.length - 20)) await rm(join(shots, f), { force: true }).catch(() => {})
}

// ---------- 凭据库（v2: 主密钥经 DPAPI 包裹） ----------
let legacyKey = null
export async function loadVault() {
  await ensureRoot()
  await cleanupArtifacts()
  const empty = { version: 2, accounts: {}, cookies: {} }
  try {
    const raw = JSON.parse(await readFile(VAULT, 'utf8'))
    let key
    if (raw.v === 2 && raw.wrappedKey) {
      key = await dpapi(Buffer.from(raw.wrappedKey, 'base64'), 'unprotect')
    } else {
      key = await readFile(KEYFILE)   // 兼容旧库
      legacyKey = key                 // 交给 loadVault 尾部删除
    }
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'))
    d.setAuthTag(Buffer.from(raw.tag, 'base64'))
    const plain = Buffer.concat([d.update(Buffer.from(raw.data, 'base64')), d.final()])
    const v = JSON.parse(plain.toString('utf8'))
    v.version = 2
    if (legacyKey) { await saveVault(v); await rm(KEYFILE, { force: true }).catch(() => {}) }
    else { await rm(KEYFILE, { force: true }).catch(() => {}) }  // v2 用不到裸密钥，残留下即删
    return v
  } catch { return empty }
}

export async function saveVault(v) {
  await ensureRoot()
  let key, wrappedKey = null
  try {
    const prev = JSON.parse(await readFile(VAULT, 'utf8'))
    if (prev.v === 2 && prev.wrappedKey) {
      key = await dpapi(Buffer.from(prev.wrappedKey, 'base64'), 'unprotect')
      wrappedKey = prev.wrappedKey
    }
  } catch {}
  if (!key) {
    key = randomBytes(32)
    try {
      wrappedKey = (await dpapi(key, 'protect')).toString('base64')
    } catch (e) {
      throw new Error('DPAPI 不可用，拒绝以明文密钥落盘: ' + (e?.message || e))
    }
  }
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([c.update(Buffer.from(JSON.stringify(v), 'utf8')), c.final()])
  await writeFile(VAULT, JSON.stringify({
    v: wrappedKey ? 2 : 1,
    wrappedKey,
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }))
  return { dpapi: !!wrappedKey }
}

// ---------- 受控浏览器（单例） ----------
export async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) })
    return r.ok
  } catch { return false }
}

export async function livePort() {
  for (const p of PORTS) if (await cdpAlive(p)) return p
  return null
}

export let lastLaunch = { exe: null, mode: null }

export async function launchBrowser(startUrl, opts = {}) {
  const alive = await livePort()
  if (alive) {
    if (startUrl) {
      try {
        const r = await fetch(`http://127.0.0.1:${alive}/json/new?${encodeURIComponent(startUrl)}`, { method: 'PUT' })
        const t = await r.json()
        if (t?.id) setCurrentTarget(t.id)
      } catch {}
    }
    return { port: alive, reused: true }
  }
  // visible=true → 必须完整浏览器（要能看/能点）；否则优先 headless-shell
  const wantVisible = opts.visible === true
  let order = forcedExe ? [forcedExe, ...BROWSER_CANDIDATES] : BROWSER_CANDIDATES
  if (wantVisible) order = order.filter((p) => p !== HS_EXE)
  else order = order.filter((p) => p !== CFT_EXE || process.env.DSH_NOVEL_AUTH_BROWSER === 'cft')
  let edge = null
  for (const p of order) { try { await stat(p); edge = p; break } catch {} }
  lastLaunch = { exe: edge, mode: wantVisible ? 'visible' : 'headless' }
  if (!edge) {
    const alive2 = await livePort()
    if (alive2) return { port: alive2, reused: true }
    throw new Error('没有可用浏览器：先跑 auth_browser_install（下载 Chrome for Testing），或装 Edge/Chrome')
  }
  const resolverRules = process.env.DSH_NOVEL_AUTH_ALLOW_GOOGLE === '1'
    ? []
    : [`--host-resolver-rules=${BLOCKED_HOSTS.map((h) => 'MAP ' + h + ' ~NOTFOUND').join(', ')}`]
  const profileDir = activeProfile()
  await mkdir(profileDir, { recursive: true })
  const port = PORTS[0]
  const child = spawn(edge, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    // 调试口只绑 loopback（默认也是，但显式写出来防被改）
    '--remote-debugging-address=127.0.0.1',
    // 关掉一切"自己往外说话"的后台行为：变体种子、组件更新、域名可靠性、同步、崩溃上报
    '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability',
    '--disable-sync', '--no-pings', '--disable-breakpad', '--disable-crash-reporter',
    '--disable-client-side-phishing-detection', '--no-service-autorun',
    '--metrics-recording-only', '--disable-default-apps',
    '--disable-features=Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions',
    ...resolverRules,
    ...((wantVisible || String(edge).includes('headless-shell')) ? [] : ['--headless=new']),
    '--no-first-run', '--no-default-browser-check',
    startUrl || 'about:blank',
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 40; i++) {
    await sleep(400)
    if (await cdpAlive(port)) {
      await writeFile(PORTFILE, String(port)).catch(() => {})
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const first = (list.find((t) => t.type === 'page') || {})
        if (first.id) setCurrentTarget(first.id)
      } catch {}
      return { port, reused: false, pid: child.pid }
    }
  }
  throw new Error('Edge 调试端口没起来')
}

/** 只杀掉用本插件 profile 起的浏览器（不碰用户自己的 Chrome/Edge） */
export async function killOwnBrowser() {
  const profile = activeProfile()
  const winPath = profile  // PowerShell 单引号里反斜杠是字面量，不能加倍
  const cmd = "$p=Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='chrome-headless-shell.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*" + winPath + "*' }; " +
    "if ($p) { $c=@($p); $c | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $c.Count } else { 0 }"
  const { execFileSync } = await import('node:child_process')
  try { return Number(execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim()) || 0 } catch { return 0 }
}

export async function closeBrowser() {
  const port = await livePort()
  if (!port) return { closed: false, reason: '没在跑' }
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    const ws = new WebSocket(v.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    await sleep(800)
    try { ws.close() } catch {}
  } catch {}
  await rm(PORTFILE, { force: true }).catch(() => {})
  stopIdleTimer()
  return { closed: !(await cdpAlive(port)), port }
}

let currentTargetId = null

export async function pageTarget(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const pages = list.filter((t) => t.type === 'page')
  if (!pages.length) return list[0]
  if (currentTargetId) {
    const hit = pages.find((t) => t.id === currentTargetId)
    if (hit) return hit
  }
  const real = pages.find((t) => t.url && !/^about:blank$|^chrome:/.test(t.url))
  return real || pages[0]
}

export function setCurrentTarget(id) { currentTargetId = id }
export function getCurrentTarget() { return currentTargetId }

// ── 按需启停 ────────────────────────────────────────────────
// 浏览器是重资源（headless-shell 常驻约 150MB）。默认「谁用谁起，闲着就关」：
// 每次 CDP 活动刷新计时，无活动 IDLE_MS 之后自动关闭。
// 抽屉每 400ms 抓一帧 → 一直有活动 → 不会误关；收起/暂停后才开始计时。
export const IDLE_MS = Number(process.env.DSH_YUNPA_IDLE_MS || 3 * 60 * 1000)
let idleTimer = null
export function touchBrowser() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(async () => {
    idleTimer = null
    const port = await livePort().catch(() => null)
    if (!port) return
    try { await closeBrowser() } catch { /* 关不掉就下次再关 */ }
  }, IDLE_MS)
  idleTimer.unref?.()
  return IDLE_MS
}
export function stopIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
}

// 页面弹窗的默认处理：true=确认，false=取消。抓取场景几乎总是要放行。
export const DIALOG_ACCEPT = process.env.DSH_YUNPA_DIALOG_DISMISS === '1' ? false : true

export async function withPage(fn) {
  const port = (await livePort()) || (await launchBrowser()).port
  const target = await pageTarget(port)
  if (!target) throw new Error('没有页面 target')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data) } catch { return }
    // 页面弹 alert/confirm/prompt 会把后续 CDP 命令挂住直到超时。
    // 收到 dialogOpening 立刻放行（默认 accept），抓取才能继续。
    if (m.method === 'Page.javascriptDialogOpening') {
      const i = ++id
      pending.set(i, () => {})
      try { ws.send(JSON.stringify({ id: i, method: 'Page.handleJavaScriptDialog', params: { accept: DIALOG_ACCEPT } })) } catch {}
      return
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id) }
  })
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  try {
    touchBrowser()
    await send('Network.enable')
    await send('Page.enable')
    return await fn({ send, port, target })
  } finally { try { ws.close() } catch {} }
}

export async function allCookies(port, domainHint) {
  const p = port || (await livePort())
  if (!p) return []
  const target = await pageTarget(p)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data) } catch { return }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m); pending.delete(m.id) }
  })
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
  const res = await new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Network.enable' })) })
  const got = await new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Network.getAllCookies' })) })
  try { ws.close() } catch {}
  const list = got.cookies || []
  if (!domainHint) return list
  const d = domainHint.replace(/^\./, '')
  return list.filter((c) => c.domain.includes(d))
}

// ---------- 自动填表 / 验证码 ----------
export async function autofill(user, pass) {
  return withPage(async ({ send, target }) => {
    const js = `(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const inputs = [...document.querySelectorAll('input')].filter(vis)
  const pwd = inputs.filter(i => (i.type||'').toLowerCase() === 'password')
  const txt = inputs.filter(i => ['text','email','tel','number',''].includes((i.type||'').toLowerCase()))
  const cap = inputs.filter(i => /captcha|verify|code|vcode|seccode|yzm/i.test((i.name||'') + (i.id||'') + (i.placeholder||'')))
  const set = (el, val) => { el.focus(); el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})) }
  if (!pwd.length) return { ok: false, reason: 'no password input', url: location.href, inputs: inputs.length }
  set(txt[0], USER)
  set(pwd[0], PASS)
  const capEl = cap[0]
  return { ok: true, url: location.href, needCaptcha: !!capEl, captchaField: capEl ? (capEl.name || capEl.id) : null, userField: txt[0] ? (txt[0].name || txt[0].id) : null }
})()`
      .replace('USER', JSON.stringify(user))
      .replace('PASS', JSON.stringify(pass))
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })
    return r.result?.value ?? r
  })
}

export async function submitForm(captcha) {
  return withPage(async ({ send }) => {
    const js = `(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const inputs = [...document.querySelectorAll('input')].filter(vis)
  const cap = inputs.find(i => /captcha|verify|code|vcode|seccode|yzm/i.test((i.name||'') + (i.id||'') + (i.placeholder||'')))
  if (cap && CAPTCHA) { cap.focus(); cap.value = CAPTCHA; cap.dispatchEvent(new Event('input',{bubbles:true})); cap.dispatchEvent(new Event('change',{bubbles:true})) }
  const btn = [...document.querySelectorAll('button,input[type=submit],a')].find(el => vis(el) && /登\s*录|登\s*入|login|sign\s*in|提交|确定/i.test(el.innerText || el.value || ''))
  if (btn) { btn.click(); return { clicked: (btn.innerText || btn.value || '').trim().slice(0,20) } }
  const pwd = inputs.find(i => (i.type||'').toLowerCase() === 'password')
  if (pwd && pwd.form) { pwd.form.submit(); return { submitted: true } }
  return { clicked: null, reason: 'no submit control' }
})()`.replace('CAPTCHA', JSON.stringify(captcha || ''))
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true })
    return r.result?.value ?? r
  })
}

export async function captchaTo(outPath) {
  return withPage(async ({ send }) => {
    const js = `(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const imgs = [...document.querySelectorAll('img')].filter(vis)
  const hit = imgs.find(i => /captcha|verify|code|vcode|seccode|yzm/i.test((i.src||'') + (i.id||'') + (i.className||'') + (i.alt||'')))
  if (!hit) return { found: false, imgs: imgs.length }
  const r = hit.getBoundingClientRect()
  return { found: true, src: hit.src, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }
})()`
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true })
    const v = r.result?.value
    if (!v?.found) return v
    let buf
    if (v.src.startsWith('data:')) {
      buf = Buffer.from(v.src.split(',')[1] || '', 'base64')
    } else {
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...v.rect, scale: 2 } })
      buf = Buffer.from(shot.data, 'base64')
    }
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, buf)
    return { found: true, file: outPath, bytes: buf.length, src: v.src.slice(0, 120) }
  })
}

export async function clearBrowserCookies() {
  return withPage(async ({ send }) => {
    const r = await send('Network.clearBrowserCookies')
    return { ok: true, cleared: r === undefined || r === null || true }
  })
}

export async function goto(url) {
  return withPage(async ({ send }) => {
    const r = await send('Page.navigate', { url })
    await sleep(2500)
    const t = await send('Runtime.evaluate', { expression: 'location.href + "|" + document.title', returnByValue: true })
    return { frameId: r.frameId, page: t.result?.value }
  })
}

// ---------- 抓取 ----------
export function domainMatch(cd, site) {
  const s = (SITES[site]?.domain || site).replace(/^\./, '')
  const d = cd.replace(/^\./, '')
  return d.includes(s) || s.includes(d)
}

export function cookieHeader(cookies, site) {
  return cookies.filter((c) => domainMatch(c.domain, site)).map((c) => `${c.name}=${c.value}`).join('; ')
}

export function decodeBody(buf, contentType) {
  const m = /charset=([\w-]+)/i.exec(contentType || '')
  const enc = (m?.[1] || '').toLowerCase()
  if (enc && enc !== 'utf-8') { try { return new TextDecoder(enc).decode(buf) } catch {} }
  const head = new TextDecoder('utf-8').decode(buf.slice(0, 4096))
  if (!head.includes('\uFFFD')) return new TextDecoder('utf-8').decode(buf)
  try { return new TextDecoder('gb18030').decode(buf) } catch { return new TextDecoder('utf-8').decode(buf) }
}

export async function fetchWith(site, url, cookies, extra = {}) {
  const header = cookieHeader(cookies || [], site)
  const r = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      'accept-language': 'zh-CN,zh;q=0.9',
      'accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      ...(header ? { cookie: header } : {}),
      ...extra,
    },
    signal: AbortSignal.timeout(30000),
  })
  const buf = Buffer.from(await r.arrayBuffer())
  return { status: r.status, url: r.url, text: decodeBody(buf, r.headers.get('content-type')), bytes: buf.length }
}

export async function probeSite(site, cookies) {
  const cfg = SITES[site]
  if (!cfg) return { site, ok: false, reason: '未知站点' }
  try {
    const r = await fetchWith(site, cfg.probe, cookies)
    const has = r.text.includes(cfg.marker)
    return { site, status: r.status, loggedIn: cfg.markerMeansLoggedOut ? !has : has, bytes: r.bytes }
  } catch (e) { return { site, ok: false, reason: String(e.message || e) } }
}

export function toText(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
}

// 贴吧 / NGA 楼层结构化提取
export function extractPosts(html, kind) {
  const strip = (s) => toText(s).replace(/\n+/g, ' ').trim()
  const out = []
  if (kind === 'tieba') {
    const authorRe = /class="[^"]*p_author_name[^"]*"[^>]*>([\s\S]*?)<\//g
    const bodyRe = /class="[^"]*d_post_content[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:post-tail|core_reply|d_post_content)|<\/div>\s*<\/div>\s*<div[^>]*class="l_post)/g
    const bodies = [...html.matchAll(bodyRe)].map((m) => strip(m[1])).filter((s) => s.length > 1)
    const authors = [...html.matchAll(authorRe)].map((m) => strip(m[1]))
    bodies.forEach((b, i) => out.push({ floor: i + 1, author: authors[i] || null, text: b }))
  } else if (kind === 'nga') {
    const re = /<div[^>]*class="[^"]*(?:postcontent|post_content)[^"]*"[^>]*>([\s\S]*?)<\/div>/g
    for (const m of html.matchAll(re)) {
      const t = strip(m[1])
      if (t.length > 1) out.push({ floor: out.length + 1, text: t })
    }
  }
  if (!out.length) {
    const t = toText(html)
    if (t) out.push({ floor: 1, text: t.slice(0, 4000), fallback: true })
  }
  return out
}

// ---------- 审计日志（只有动作与站点，不含任何凭据） ----------
export async function audit(action, meta = {}) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), action, ...meta })
    await appendFile(join(ROOT, 'audit.jsonl'), line + '\n')
  } catch {}
}

/** 把 URL 里的 query 抹掉再进日志/错误信息（防 token 泄漏） */
export function safeUrl(u) {
  try { const x = new URL(u); return x.origin + x.pathname } catch { return String(u).split('?')[0] }
}

export function safeErr(e) {
  return String(e?.message || e).replace(/https?:\/\/[^\s"']+/g, (m) => safeUrl(m))
}


// ---------- 崩溃日志（任何异常都要留痕，且能还原） ----------
export async function crash(source, err, extra = {}) {
  try {
    // 离线审计（import 插件跑 apply() 做 schema 校验）会触发 boot 记录，污染真实故障日志。
    // 设 YUNPA_CRASH_SILENT=1 即可静音，只影响写盘，不影响返回值。
    if (String(process.env.YUNPA_CRASH_SILENT || '') === '1') return
    const e = err && typeof err === 'object' ? err : { message: String(err) }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      source,
      message: String(e.message || e).slice(0, 800),
      stack: String(e.stack || '').split(String.fromCharCode(10)).slice(0, 12).join(String.fromCharCode(10)),
      ...extra,
    })
    await appendFile(join(ROOT, 'crash.jsonl'), line + String.fromCharCode(10))
  } catch {}
}

let crashHooksInstalled = false
export function installCrashHandlers() {
  if (crashHooksInstalled) return
  crashHooksInstalled = true
  const on = (name) => (err) => { crash('host:' + name, err) }
  process.on('uncaughtException', (e) => { on('uncaughtException')(e); console.error('[yunpa]', e) })
  process.on('unhandledRejection', on('unhandledRejection'))
}
