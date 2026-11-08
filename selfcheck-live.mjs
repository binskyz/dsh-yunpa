#!/usr/bin/env node
// 实时画面面板的验收：接口、图像、输入回放、视口跟随，跑 N 轮（默认 5）。
//   node selfcheck-live.mjs            5 轮
//   node selfcheck-live.mjs --rounds 3
// 每轮独立判定，任何一轮红都会在结尾汇总里点名。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './core.js'

const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : Number(argv[i + 1]) || d }
const ROUNDS = opt('rounds', 5)
const TOKEN = (() => { try { return readFileSync(join(ROOT, 'api-token.txt'), 'utf8').trim() } catch { return '' } })()
const OUT = join(ROOT, 'shots')
mkdirSync(OUT, { recursive: true })

// DSH web 端口每次重启都变，靠探测而不是写死
const findPort = async () => {
  const forced = opt('port', 0)
  if (forced) return forced
  const { execFileSync } = await import('node:child_process')
  let out = ''
  try { out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }) } catch { return 0 }
  const ports = [...new Set([...out.matchAll(/:(\d{4,5})\s+\S+\s+LISTENING/gi)].map((m) => Number(m[1])))]
  for (const p of ports) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/api/yunpa/status`, { signal: AbortSignal.timeout(800) })
      if (!r.ok) continue
      const j = await r.json().catch(() => null)
      // 只认 DSH 的 yunpa 接口，别的服务也可能回 200
      if (j && j.ok === true && j.browser) return p
    } catch { /* 不是 DSH */ }
  }
  return 0
}
const PORT = await (async () => {
  const first = await findPort()
  if (first) return first
  const wait = opt('wait', 0)
  if (!wait) return 0
  // --wait 120：重启后进程还没起来时，最多等 120 秒
  console.log(`等 DSH web 起来（最多 ${wait}s）…`)
  const deadline = Date.now() + wait * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const p = await findPort()
    if (p) return p
    process.stdout.write('·')
  }
  return 0
})()
if (!PORT) { console.error('没找到在跑的 DSH web（/api/yunpa/status 全都不通）'); process.exit(2) }
const BASE = `http://127.0.0.1:${PORT}/api/yunpa`
console.log(`目标端口：${PORT}`)

const jpegSize = (buf) => {
  let i = 2
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) { i++; continue }
    const m = buf[i + 1]
    const len = buf.readUInt16BE(i + 2)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return null
}

const results = []
const rec = (round, name, ok, info) => {
  results.push({ round, name, ok, info })
  console.log(`  ${ok ? '✅' : '❌'} [R${round}] ${name} :: ${info}`)
}

const json = async (path, init) => {
  const r = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  const text = await r.text()
  try { return { status: r.status, body: JSON.parse(text) } } catch { return { status: r.status, body: text } }
}

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n── 第 ${round}/${ROUNDS} 轮 ──`)

  // 1) 后端活着且浏览器在跑
  const st = await json('/status')
  const running = st.body?.browser?.running === true
  rec(round, 'GET /status', st.status === 200 && running, `running=${running} port=${st.body?.browser?.port}`)

  // 2) 画面能取到，并且是真图（不是错误文本）
  const res = await fetch(BASE + '/live.png?q=62')
  const buf = Buffer.from(await res.arrayBuffer())
  const size = res.ok ? jpegSize(buf) : null
  rec(round, 'GET /live.png', res.ok && !!size && buf.length > 500,
    `${res.status} ${res.headers.get('content-type')} ${buf.length}B ${size ? size.w + 'x' + size.h : '非 JPEG'}`)
  if (round === 1 && buf.length > 500) writeFileSync(join(OUT, 'selfcheck-live.jpg'), buf)

  // 3) 关键回归：前端 fetch 不带 Origin 时必须也能写（否则面板里的点击/打字全废）
  const nokey = await json('/live/key', { method: 'POST', body: JSON.stringify({ key: 'Escape' }) })
  rec(round, 'POST 无 Origin（前端真实形态）', nokey.body?.ok === true, JSON.stringify(nokey.body).slice(0, 80))

  // 4) 坐标点击与文本输入
  const click = await json('/live/click', { method: 'POST', body: JSON.stringify({ x: 120, y: 160 }) })
  const typed = await json('/live/type', { method: 'POST', body: JSON.stringify({ text: 'a' }) })
  rec(round, '点击 / 输入回放', click.body?.ok === true && typed.body?.ok === true,
    `click=${click.body?.ok} type=${typed.body?.ok}`)

  // 5) 视口跟随面板尺寸
  const target = round % 2 === 0 ? { w: 420, h: 560 } : { w: 480, h: 600 }
  const size2 = await json('/live/size', { method: 'POST', body: JSON.stringify(target) })
  await new Promise((r) => setTimeout(r, 250))
  const res2 = await fetch(BASE + '/live.png?q=62')
  const b2 = Buffer.from(await res2.arrayBuffer())
  const s2 = res2.ok ? jpegSize(b2) : null
  const followed = !!s2 && Math.abs(s2.w - target.w) <= 2 && Math.abs(s2.h - target.h) <= 2
  rec(round, '视口跟随 /live/size', size2.body?.ok === true && followed,
    `要 ${target.w}x${target.h} → 实际 ${s2 ? s2.w + 'x' + s2.h : '取不到'}`)

  // 6) 画面真的会变（换页面后帧大小应变化）
  const nav = await json('/live/nav', { method: 'POST', body: JSON.stringify({ url: round % 2 ? 'https://example.com' : 'https://example.org' }) })
  await new Promise((r) => setTimeout(r, 800))
  const res3 = await fetch(BASE + '/live.png?q=62')
  const b3 = Buffer.from(await res3.arrayBuffer())
  const changed = Math.abs(b3.length - buf.length) > 500
  rec(round, '导航后画面变化', nav.body?.ok === true && changed, `${buf.length}B → ${b3.length}B`)

  await new Promise((r) => setTimeout(r, 200))
}

const bad = results.filter((r) => !r.ok)
console.log(`\n════ 汇总：${results.length - bad.length}/${results.length} 通过 ════`)
if (bad.length) {
  for (const b of bad) console.log(`  ❌ R${b.round} ${b.name} :: ${b.info}`)
  process.exit(1)
}
console.log(`证据图：${join(OUT, 'selfcheck-live.jpg')}`)
