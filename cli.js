// CLI：不开 DSH 会话也能测/跑（node cli.js <cmd> ...）
import { listLogins, importToProfile } from './edge_creds.js'
import { EDGE_PROFILE } from './core.js'
import { loadVault, saveVault, probeSite, fetchWith, extractPosts, toText, launchBrowser, closeBrowser, livePort, allCookies, SITES, ROOT, VAULT } from './core.js'

const [cmd, ...rest] = process.argv.slice(2)
const arg = (k, d) => { const i = rest.indexOf(`--${k}`); return i < 0 ? d : rest[i + 1] }
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))

switch (cmd) {
  case 'status': {
    const v = await loadVault()
    const sites = [...new Set([...Object.keys(v.cookies), ...Object.keys(v.accounts)].map((k) => k.replace(/__updated$/, '')))]
    const rows = []
    for (const s of sites) {
      const ck = v.cookies[s] || []
      rows.push({ site: s, cookies: ck.length, account: v.accounts[s]?.username || null, probe: ck.length ? await probeSite(s, ck) : null })
    }
    out({ root: ROOT, vault: VAULT, browser: await livePort(), sites: rows })
    break
  }
  case 'vault-set': {
    const v = await loadVault()
    v.accounts[arg('site')] = { username: arg('user', ''), password: arg('pass', ''), savedAt: new Date().toISOString() }
    out({ saved: await saveVault(v), site: arg('site') })
    break
  }
  case 'cookie': {
    const site = arg('site'), raw = arg('cookie', '')
    const domain = SITES[site]?.domain || site
    const list = raw.split(/;\s*/).filter(Boolean).map((kv) => {
      const i = kv.indexOf('=')
      return { name: i < 0 ? kv : kv.slice(0, i), value: i < 0 ? '' : kv.slice(i + 1), domain: String(domain).startsWith('.') ? domain : `.${domain}`, path: '/', expires: -1 }
    })
    const v = await loadVault(); v.cookies[site] = list; v.cookies[`${site}__updated`] = new Date().toISOString()
    out({ saved: await saveVault(v), cookies: list.length, probe: await probeSite(site, list) })
    break
  }
  case 'open': {
    const url = arg('url', SITES[arg('site')]?.login || 'about:blank')
    const visible = rest.includes('--visible')
    out(await launchBrowser(url, { visible }))
    break
  }
  case 'close': out(await closeBrowser()); break
  case 'capture': {
    const site = arg('site')
    const port = await livePort()
    if (!port) { out({ error: 'browser not running' }); break }
    const got = await allCookies(port, SITES[site]?.domain || site)
    const v = await loadVault()
    v.cookies[site] = got.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires ?? -1 }))
    v.cookies[`${site}__updated`] = new Date().toISOString()
    out({ saved: await saveVault(v), cookies: got.length, probe: await probeSite(site, v.cookies[site]) })
    break
  }
  case 'fetch': {
    const site = arg('site'), url = arg('url')
    const v = await loadVault()
    const r = await fetchWith(site, url, v.cookies[site] || [])
    const kind = arg('kind', 'text')
    const body = kind === 'posts' ? extractPosts(r.text, site) : kind === 'raw' ? r.text : toText(r.text)
    out({ status: r.status, bytes: r.bytes, sample: Array.isArray(body) ? body.slice(0, 3) : String(body).slice(0, 600) })
    break
  }
  case 'edge-list': {
    const rows = await listLogins({ browser: arg('browser','edge') })
    const schemes = {}
    for (const r of rows) schemes[r.scheme] = (schemes[r.scheme]||0)+1
    const host = arg('host','')
    out({ total: rows.length, schemes, items: rows.filter(r=>!host||r.host.includes(host)).slice(0,30).map(r=>({host:r.host,user:r.username,len:r.passwordLength,scheme:r.scheme})) })
    break
  }
  case 'edge-import': {
    out(await importToProfile({ browser: arg('browser','edge'), destProfile: EDGE_PROFILE }))
    break
  }
  default:
    console.log('用法: node cli.js status|vault-set|cookie|open|close|capture|fetch [--site s] [--url u] [--cookie c] [--user u] [--pass p] [--kind text|posts|raw]')
}
