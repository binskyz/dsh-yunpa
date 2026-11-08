// api.js · 给设置页用的本地 HTTP 路由（挂在 /api/yunpa 下，同源）
// 只有本机 webServer 会注册它；数据全部来自本机加密库与浏览器，不外发。
import { loadVault, saveVault, probeSite, SITES, ROOT, VAULT, CFT_EXE, livePort, closeBrowser, launchBrowser, audit, crash, loadSites, saveSites } from './core.js'
import { listLogins } from './edge_creds.js'
// 实时画面与坐标回放：让侧边栏面板里能看、能点，不必弹独立窗口
import { liveShot, liveInfo, clickAt, typeText, pressKey, scrollBy } from './browser.js'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TOKEN_FILE = join(ROOT, 'api-token.txt')
function token() {
  try { return readFileSync(TOKEN_FILE, 'utf8').trim() } catch {
    const t = randomBytes(24).toString('hex')
    try { writeFileSync(TOKEN_FILE, t, { mode: 0o600 }) } catch {}
    return t
  }
}
const expected = token()
let edgeCache = { ts: 0, data: null }
const EDGE_TTL = 60000
let countCache = { ts: 0, data: null }
const COUNT_TTL = 10000

const mask = (s) => (!s ? '' : s.length <= 2 ? '*'.repeat(s.length) : s[0] + '*'.repeat(s.length - 2) + s.slice(-1))

async function logCounts() {
  if (countCache.data && Date.now() - countCache.ts < COUNT_TTL) return { ...countCache.data, cached: true }
  const { readFile: rf } = await import('node:fs/promises')
  const count = async (f) => (await rf(ROOT + '/' + f, 'utf8').catch(() => '')).trim().split(String.fromCharCode(10)).filter(Boolean).length
  countCache = { ts: Date.now(), data: { audit: await count('audit.jsonl'), crash: await count('crash.jsonl') } }
  return countCache.data
}

export function createApi() {
  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    const marker = '/api/yunpa'
    const at = url.pathname.indexOf(marker)
    const route = (at >= 0 ? url.pathname.slice(at + marker.length) : url.pathname).replace(/\/+$/, '') || '/'
    const method = String(req.method || 'GET').toUpperCase()
    const send = (status, payload) => {
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(body)
    }
    const readBody = () => new Promise((resolve) => {
      let raw = ''
      req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy() })
      req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) } })
    })
    const sendBin = (status, buf, type) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'content-length': buf.length })
      res.end(buf)
    }

    // 只认同源页面或带 token 的本机 CLI；跨站网页一律 403
    const origin = req.headers.origin
    const host = req.headers.host
    const sameOrigin = !origin || origin === 'http://' + host || origin === 'https://' + host
    const cliOk = req.headers['x-yunpa-token'] === expected
    if (!sameOrigin) return send(403, { ok: false, error: 'cross-origin blocked' })
    // 页面内 fetch 会带同源 Origin 或 sec-fetch-site；无 Origin 的裸请求（curl/CLI）写操作要 token
    if (!origin && method !== 'GET' && !cliOk) return send(403, { ok: false, error: 'token required' })
    if (method === 'OPTIONS') return send(204, {})

    try {
      if (route === '/sites') {
        if (method === 'GET') return send(200, { ok: true, sites: loadSites() })
        const body = await readBody()
        const cur = loadSites()
        if (body.action === 'del') { delete cur[body.site] } else if (body.site && body.cfg) { cur[body.site] = body.cfg } else {
          return send(400, { ok: false, error: 'need site + cfg' })
        }
        const keys = await saveSites(cur)
        await audit('sites-write', { site: body.site, action: body.action || 'set' })
        return send(200, { ok: true, keys })
      }
      if (route === '/client-error' && method === 'POST') {
        const body = await readBody()
        await crash('client', { message: body.message, stack: body.stack })
        return send(200, { ok: true })
      }
      if (route === '/crashes') {
        const { readFile: rf } = await import('node:fs/promises')
        const raw = await rf(ROOT + '/crash.jsonl', 'utf8').catch(() => '')
        const lines = raw.trim().split(String.fromCharCode(10)).filter(Boolean).slice(-20)
        return send(200, { ok: true, entries: lines.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) })
      }
      if (route === '/audit') {
        const { readFile: rf } = await import('node:fs/promises')
        const raw = await rf(ROOT + '/audit.jsonl', 'utf8').catch(() => '')
        const lim = Math.min(200, Number(url.searchParams.get('limit') || 50) || 50)
        const lines = raw.trim().split(String.fromCharCode(10)).filter(Boolean).slice(-lim)
        return send(200, { ok: true, entries: lines.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) })
      }
      // ── 实时画面：面板里内嵌「浏览器」，不弹独立窗口 ──
      if (route === '/live.png') {
        // <img> 请求不带 Origin，靠同源策略兜底：只有 127.0.0.1 上这个页面能取到画面。
        // 刻意不校验 sec-fetch-*（Electron/自定义协议的 renderer 常常不带这些头，会把图打成 403）。
        try {
          // 浏览器没起时不要为了抓帧把它拉起来（withPage 会自动 launch）
          const livePortNow = await livePort()
          if (!livePortNow) return sendBin(503, Buffer.from('browser not running'), 'text/plain')
          const s = await liveShot({ quality: Number(url.searchParams.get('q') || 72) || 72 })
          if (!s.ok) return sendBin(502, Buffer.from(String(s.error || 'shot failed')), 'text/plain')
          return sendBin(200, Buffer.from(s.base64, 'base64'), 'image/jpeg')
        } catch (e) {
          return sendBin(502, Buffer.from(String(e?.message || e)), 'text/plain')
        }
      }
      if (route === '/live/info') return send(200, { ok: true, ...(await liveInfo()) })
      if (route === '/live/click' && method === 'POST') {
        const b = await readBody()
        const x = Number(b.x), y = Number(b.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return send(400, { ok: false, error: 'need x/y' })
        await audit('live-click', { x: Math.round(x), y: Math.round(y) })
        return send(200, await clickAt(x, y, { clickCount: Number(b.clickCount) || 1 }))
      }
      if (route === '/live/type' && method === 'POST') {
        const b = await readBody()
        return send(200, await typeText(String(b.text || '').slice(0, 2000)))
      }
      if (route === '/live/key' && method === 'POST') {
        const b = await readBody()
        return send(200, await pressKey(String(b.key || 'Enter')))
      }
      if (route === '/live/scroll' && method === 'POST') {
        const b = await readBody()
        return send(200, await scrollBy(Number(b.dy) || 0, Number(b.x) || 200, Number(b.y) || 200))
      }
      if (route === '/live/nav' && method === 'POST') {
        const b = await readBody()
        const target = String(b.url || '').trim()
        if (!/^https?:\/\//i.test(target)) return send(400, { ok: false, error: 'need http(s) url' })
        const core = await import('./core.js')
        await core.goto(target)
        await audit('live-nav', { url: target.slice(0, 200) })
        return send(200, { ok: true, url: target })
      }
      if (route === '/status') {
        const v = await loadVault()
        const port = await livePort()
        const sites = new Set([...Object.keys(v.cookies), ...Object.keys(v.accounts)].map((k) => k.replace(/__updated$/, '')))
        return send(200, {
          ok: true,
          browser: { running: !!port, port, exe: CFT_EXE },
          paths: { root: ROOT, vault: VAULT },
          sites: [...sites].map((s) => ({
            site: s,
            cookies: (v.cookies[s] || []).length,
            account: v.accounts[s] ? { username: mask(v.accounts[s].username), passwordLen: (v.accounts[s].password || '').length, savedAt: v.accounts[s].savedAt, source: v.accounts[s].source || 'vault' } : null,
            updated: v.cookies[`${s}__updated`] || null,
          })),
          known: Object.keys(SITES),
          counts: await logCounts(),
        })
      }
      if (route === '/vault') {
        const v = await loadVault()
        return send(200, {
          ok: true,
          accounts: Object.entries(v.accounts).map(([s, a]) => ({
            site: s, username: mask(a.username), passwordLen: (a.password || '').length,
            savedAt: a.savedAt, source: a.source || 'vault',
          })),
          cookieSites: Object.keys(v.cookies).filter((k) => !k.endsWith('__updated')).map((s) => ({ site: s, cookies: (v.cookies[s] || []).length })),
        })
      }
      if (route === '/edge' && url.searchParams.get('fresh') !== '1' && edgeCache.data && Date.now() - edgeCache.ts < EDGE_TTL) {
        return send(200, { ...edgeCache.data, cached: true, ageMs: Date.now() - edgeCache.ts })
      }
      if (route === '/edge') {
        const rows = await listLogins({ browser: 'edge', profile: 'Default' })
        const schemes = {}
        for (const r of rows) schemes[r.scheme] = (schemes[r.scheme] || 0) + 1
        const q = url.searchParams.get('q') || ''
        const items = rows
          .filter((r) => !q || r.host.includes(q))
          .slice(0, 60)
          .map((r) => ({ host: r.host, username: mask(r.username), passwordLen: r.passwordLength, scheme: r.scheme }))
        const payload = { ok: true, total: rows.length, schemes, items }
        edgeCache = { ts: Date.now(), data: payload }
        return send(200, payload)
      }
      if (route === '/probe' && method === 'POST') {
        const { site } = await readBody()
        const v = await loadVault()
        return send(200, { ok: true, site, result: await probeSite(site, v.cookies[site] || []) })
      }
      if (route === '/forget' && method === 'POST') {
        const { site } = await readBody()
        const v = await loadVault()
        delete v.accounts[site]; delete v.cookies[site]; delete v.cookies[`${site}__updated`]
        const saved = await saveVault(v)
        await audit('forget', { site })
        return send(200, { ok: true, site, encrypted: saved.dpapi })
      }
      if (route === '/action' && method === 'POST') {
        const { name } = await readBody()
        if (name === 'open') { const b = await launchBrowser('about:blank'); await audit('browser-open', {}); return send(200, { ok: true, ...b }) }
        if (name === 'close') return send(200, { ok: true, ...(await closeBrowser()) })
        if (name === 'selfcheck') {
          const v = await loadVault()
          const port = await livePort()
          const saved = await saveVault(v)
          return send(200, { ok: true, checks: [
            { name: '凭据库可解密', ok: true, info: 'dpapi=' + saved.dpapi },
            { name: '浏览器', ok: !!port, info: port ? 'port ' + port : '未启动' },
            { name: '已存站点', ok: true, info: String(Object.keys(v.cookies).filter((k) => !k.endsWith('__updated')).length) + ' 个 / ' + Object.keys(v.accounts).length + ' 组账号' },
          ] })
        }
        return send(400, { ok: false, error: 'unknown action' })
      }
      if (route === '/' ) return send(200, { ok: true, routes: ['/status', '/vault', '/edge', '/probe', '/forget', '/action', '/live.png', '/live/info', '/live/click', '/live/type', '/live/key', '/live/scroll', '/live/nav'] })
      return send(404, { ok: false, error: 'not found', route })
    } catch (e) {
      return send(500, { ok: false, error: String(e?.message || e) })
    }
  }
}
