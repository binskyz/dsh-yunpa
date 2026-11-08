// pwmigrate.js · 把 Edge/Chrome 密码管理器里的密码"转移"出来
// 原理：v20(App-Bound) 离线解不开，但浏览器自己填表时会把明文写进 DOM，
//       所以用受控浏览器打开对应登录页 → 触发自动填充 → 读 input.value。
//       全程不提交表单，明文只在本机内存与加密库里。
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listLogins } from './edge_creds.js'
import { launchBrowser, goto, closeBrowser, withPage, sleep, ROOT } from './core.js'
import { tryPasswordManagerFill, fieldValues } from './edge-keyfill.js'

const TMP_PROFILE = join(tmpdir(), 'dsh-yunpa-pw')

async function seedProfileFrom(userData, profile) {
  // 直接把用户主 profile 的 Login Data + 密钥同步到临时 profile，让浏览器自己解密
  const { importToProfile } = await import('./edge_creds.js')
  return importToProfile({ browser: 'edge', profile, destProfile: TMP_PROFILE })
}

export function mask(s) {
  if (!s) return ''
  if (s.length <= 2) return '*'.repeat(s.length)
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}

export async function dumpPasswords({ hosts = [], limit = 3, clickWaitMs = 1500 } = {}) {
  const rows = await listLogins({ browser: 'edge', profile: 'Default' })
  let cands = rows.filter((r) => r.username || r.scheme !== 'empty')
  if (hosts.length) cands = cands.filter((r) => hosts.some((h) => r.host.includes(h)))
  cands = cands.slice(0, limit)

  await seedProfileFrom(null, 'Default')
  useEdgeAsDecryptor()
  await launchBrowser('about:blank')
  // 只要浏览器起来，磁盘上那份 Login Data 副本立刻没用了
  await rm(join(TMP_PROFILE, 'Default', 'Login Data'), { force: true }).catch(() => {})
  await rm(join(TMP_PROFILE, 'Local State'), { force: true }).catch(() => {})

  const out = []
  for (const row of cands) {
    const url = row.origin
    try {
      await goto(url)
      await sleep(clickWaitMs)
      const diag = await withPage(async ({ send }) => {
        const r = await send('Runtime.evaluate', { expression: 'document.querySelectorAll("input").length + "|" + document.title', returnByValue: true })
        return r.result?.value
      })
      const fill = await tryPasswordManagerFill()
      const vals = fill.values || (await fieldValues())
      const account = (vals || []).find((v) => v.type !== 'password' && v.filled)
      const pwd = (vals || []).find((v) => v.type === 'password' && v.filled)
      if (pwd?.filled) {
        const raw = await readPasswordValue()
        out.push({ host: row.host, origin: url, username: row.username, password: raw, ok: true })
      } else {
        out.push({ host: row.host, origin: url, username: row.username, ok: false, reason: fill.ok ? 'no-password-slot' : (fill.reason || 'autofill-not-triggered'), page: diag, values: vals })
      }
    } catch (e) {
      out.push({ host: row.host, origin: url, ok: false, reason: String(e.message || e) })
    }
  }
  await closeBrowser()
  resetBrowser()
  await rm(TMP_PROFILE, { recursive: true, force: true }).catch(() => {})
  return out
}

export async function readPasswordValue() {
  return withPage(async ({ send }) => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => { const p=[...document.querySelectorAll('input[type=password]')].find(i=>i.value); return p?p.value:'' })()`,
      returnByValue: true,
    })
    return r.result?.value || ''
  })
}

export function summary(entries) {
  return entries.map((e) => ({
    host: e.host,
    ok: e.ok,
    username: e.username ? mask(e.username) : '',
    passwordLen: e.password ? e.password.length : 0,
    reason: e.reason || null,
  }))
}

export async function exportCsv(entries, path) {
  const esc = (v) => '"' + String(v || '').replace(/"/g, '""') + '"'
  const lines = ['name,url,username,password']
  for (const e of entries.filter((x) => x.ok)) lines.push([esc(e.host), esc(e.origin), esc(e.username), esc(e.password)].join(','))
  await writeFile(path, lines.join('\n'), 'utf8')
  return { file: path, rows: lines.length - 1 }
}

// 迁移必须用「密码库来源浏览器」解密：Edge 的 v20 只能被 Edge 自己打开
import { EDGE_EXE, setBrowserExe, setProfileDir } from './core.js'
export function useEdgeAsDecryptor() { setBrowserExe(EDGE_EXE); setProfileDir(TMP_PROFILE) }
export function resetBrowser() { setBrowserExe(null); setProfileDir(null) }

// 半自动路线：打开登录页 → 你点一下 Edge 的自动填充建议 → 我读 DOM 存进加密库
export async function openForManualFill(origin) {
  await seedProfileFrom(null, 'Default')
  useEdgeAsDecryptor()
  const b = await launchBrowser('about:blank')
  await goto(origin)
  await rm(join(TMP_PROFILE, 'Default', 'Login Data'), { force: true }).catch(() => {})
  return { port: b.port, origin, hint: '在窗口里点账号框，选中 Edge 的自动填充建议（一次点击），然后调 auth_pw_grab' }
}

export async function grabFilled() {
  return withPage(async ({ send }) => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const inputs = [...document.querySelectorAll('input')].filter(vis)
  const pwd = inputs.find(i => (i.type||'').toLowerCase() === 'password' && i.value)
  const user = inputs.find(i => ['text','email','tel',''].includes((i.type||'').toLowerCase()) && i.value && i !== pwd)
  return { host: location.hostname, url: location.href, username: user ? user.value : '', password: pwd ? pwd.value : '' }
})()`,
      returnByValue: true,
    })
    return r.result?.value || null
  })
}
