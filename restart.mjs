// 重启 DSH 并跑验收。用法：node restart.mjs [--verify]
//   node restart.mjs            只重启
//   node restart.mjs --verify   重启后跑 5 轮实时画面自检，结果写 shots/selfcheck-live.log
//
// 为什么要重启：host 半身（api.js / browser.js）在进程启动时就被 import 缓存了，
// 改文件不会重载；client 半身（client.js）才会热更新。所以「UI 变了接口没变」时只能重启。
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXE = 'Y:/07_AI模型/dsh/DeepSeek Harness.exe'
const NAMES = ['DeepSeek Harness.exe']
const VERIFY = process.argv.includes('--verify')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const log = (...a) => console.log(...a)

if (!existsSync(EXE)) {
  log(`找不到 ${EXE}；改 EXE 常量或手动启动 DSH`)
  process.exit(1)
}

log('[1/3] 结束当前 DSH 进程…')
for (const n of NAMES) {
  try { execFileSync('taskkill', ['/IM', n, '/F'], { stdio: 'ignore' }) } catch { /* 本来就没跑 */ }
}
await sleep(3500)

log('[2/3] 启动 DSH…')
spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref()

if (!VERIFY) {
  log('已启动。要验收就跑：node selfcheck-live.mjs --rounds 5 --wait 120')
  process.exit(0)
}

log('[3/3] 等 web 起来并跑 5 轮自检…')
try {
  const out = execFileSync(process.execPath, ['selfcheck-live.mjs', '--rounds', '5', '--wait', '150'], {
    cwd: HERE, encoding: 'utf8', timeout: 600000,
  })
  process.stdout.write(out)
  mkdirSync(join(HERE, 'shots'), { recursive: true })
  writeFileSync(join(HERE, 'shots', 'selfcheck-live.log'), out, 'utf8')
  log('\n日志：' + join(HERE, 'shots', 'selfcheck-live.log'))
} catch (e) {
  const out = (e.stdout || '') + (e.stderr || '') || String(e)
  process.stdout.write(out)
  mkdirSync(join(HERE, 'shots'), { recursive: true })
  writeFileSync(join(HERE, 'shots', 'selfcheck-live.log'), out, 'utf8')
  log('\n有失败项，见日志：' + join(HERE, 'shots', 'selfcheck-live.log'))
  process.exit(1)
}
