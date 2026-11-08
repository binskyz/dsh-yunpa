// edge_creds.js · 读 Edge/Chrome 密码管理器（Login Data），只在本机解密、不回显明文
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { createDecipheriv } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { dpapi } from './core.js'

const BROWSERS = {
  edge: ['Microsoft', 'Edge'],
  chrome: ['Google', 'Chrome'],
  brave: ['BraveSoftware', 'Brave-Browser'],
}

export function browserRoot(kind = 'edge', profile = 'Default') {
  const base = process.env.LOCALAPPDATA
  if (!base) throw new Error('LOCALAPPDATA 为空')
  const [vendor, product] = BROWSERS[kind] || BROWSERS.edge
  return { userData: join(base, vendor, product, 'User Data'), profile }
}

async function copyShared(src, dst) {
  // 用 PowerShell 以 FileShare.ReadWrite 复制（浏览器持有句柄时也能读）
  const script = `$s=[IO.File]::Open('${src}','Open','Read','ReadWrite');` +
    `$d=[IO.File]::Create('${dst}');$s.CopyTo($d);$d.Close();$s.Close();'ok'`
  await new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim() || 'copy failed'))))
  })
}

export async function masterKey(userData) {
  const state = JSON.parse(await readFile(join(userData, 'Local State'), 'utf8'))
  const enc = Buffer.from(state.os_crypt.encrypted_key, 'base64')
  if (enc.subarray(0, 5).toString() !== 'DPAPI') throw new Error('encrypted_key 不是 DPAPI 包裹')
  return dpapi(enc.subarray(5), 'unprotect')
}

export function decryptPassword(blob, key) {
  if (!blob || !blob.length) return { pw: '', scheme: 'empty' }
  const tag = blob.subarray(0, 3).toString()
  if (tag === 'v10' || tag === 'v11') {
    const iv = blob.subarray(3, 15)
    const ct = blob.subarray(15)
    try {
      const d = createDecipheriv('aes-256-gcm', key, iv)
      d.setAuthTag(ct.subarray(ct.length - 16))
      const body = ct.subarray(0, ct.length - 16)
      return { pw: Buffer.concat([d.update(body), d.final()]).toString('utf8'), scheme: tag }
    } catch (e) {
      return { pw: '', scheme: tag + ':fail' }
    }
  }
  if (tag === 'v20') return { pw: '', scheme: 'v20(app-bound)' }
  return { pw: blob.toString('utf8'), scheme: 'plain' }
}

export async function listLogins({ browser = 'edge', profile = 'Default', decrypt = true } = {}) {
  const { userData } = browserRoot(browser, profile)
  const src = join(userData, profile, 'Login Data')
  const dir = join(tmpdir(), 'dsh-edge-logins-' + Date.now())
  await mkdir(dir, { recursive: true })
  const dst = join(dir, 'Login Data')
  await copyShared(src, dst)
  const db = new DatabaseSync(dst, { readOnly: true })
  let rows = []
  try {
    rows = db.prepare('SELECT origin_url, username_value, password_value, signon_realm FROM logins').all()
  } finally { db.close() }
  await rm(dir, { recursive: true, force: true })

  let key = null
  if (decrypt) { try { key = await masterKey(userData) } catch {} }
  return rows.map((r) => {
    const blob = Buffer.from(r.password_value || [])
    const d = key ? decryptPassword(blob, key) : { pw: '', scheme: 'not-decrypted' }
    return {
      origin: r.origin_url,
      host: safeHost(r.origin_url),
      username: r.username_value || '',
      hasPassword: !!d.pw,
      passwordLength: d.pw.length,
      scheme: d.scheme,
      _pw: d.pw,
    }
  })
}

function safeHost(u) {
  try { return new URL(u).hostname } catch { return String(u || '') }
}

export function pickForSite(logins, site) {
  const want = String(site).toLowerCase()
  const cands = logins.filter((l) => l.host && (l.host.includes(want) || want.includes(l.host.replace(/^www\./, ''))))
  return cands.length ? cands[0] : null
}

export async function logout() {}
export { writeFile }

// 把用户主 profile 的密码库同步进受控 profile：Edge 自己解密（v20 只能这么做）
export async function importToProfile({ browser = 'edge', profile = 'Default', destProfile }) {
  const { userData } = browserRoot(browser, profile)
  const srcDb = join(userData, profile, 'Login Data')
  const srcState = join(userData, 'Local State')
  const dstDb = join(destProfile, 'Login Data')
  const dstState = join(destProfile, 'Local State')
  await mkdir(destProfile, { recursive: true })
  await copyShared(srcDb, dstDb)

  let merged = 0
  try {
    const src = JSON.parse(await readFile(srcState, 'utf8'))
    let dst = {}
    try { dst = JSON.parse(await readFile(dstState, 'utf8')) } catch {}
    dst.os_crypt = dst.os_crypt || {}
    for (const k of ['app_bound_encrypted_key', 'encrypted_key']) {
      if (src.os_crypt?.[k]) { dst.os_crypt[k] = src.os_crypt[k]; merged++ }
    }
    await writeFile(dstState, JSON.stringify(dst), 'utf8')
  } catch (e) {
    return { db: true, keys: false, reason: String(e.message || e) }
  }
  return { db: true, keys: merged }
}
