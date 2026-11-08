// upgrade.mjs · 浏览器版本体检 / 一键更新（默认先查后问，--apply 才动文件）
// 用法：
//   node upgrade.mjs            # 只查：本地 vs 最新 Stable
//   node upgrade.mjs --apply    # 下载并替换（旧目录改名 .bak-时间戳 回退）
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, HS_EXE, HS_VERSION_FILE } from './core.js'

const HS_DIR = join(ROOT, 'hs')
const ZIP = join(HS_DIR, 'hs.zip')
const apply = process.argv.includes('--apply')

const meta = await (await fetch('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json')).json()
const stable = meta.channels.Stable
const url = stable.downloads['chrome-headless-shell'].find((x) => x.platform === 'win64').url

let local = null
try { local = readFileSync(HS_VERSION_FILE, 'utf8').trim() } catch {}
if (!local && existsSync(HS_EXE)) {
  try {
    const out = execFileSync(HS_EXE, ['--version'], { encoding: 'utf8' }).trim()
    local = (out.match(/[\d.]+/) || [null])[0]
  } catch {}
}

console.log('本地 headless-shell:', local || '未安装')
console.log('最新 Stable        :', stable.version)
if (local === stable.version) { console.log('已是最新，无需更新'); process.exit(0) }
if (!apply) { console.log('\n要更新就加 --apply（会下载 ' + Math.round(120) + 'MB 并替换，旧目录留 .bak）'); process.exit(0) }

console.log('\n下载中…', url)
mkdirSync(HS_DIR, { recursive: true })
execFileSync('curl.exe', ['-L', '--retry', '3', '-o', ZIP, url], { stdio: 'inherit' })
console.log('解包…')
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -LiteralPath '${ZIP}' -DestinationPath '${HS_DIR}' -Force`], { stdio: 'inherit' })

const dir = join(HS_DIR, 'chrome-headless-shell-win64')
if (existsSync(dir)) {
  const bak = dir + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-')
  renameSync(dir, bak)
  console.log('旧版本改名:', bak)
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${ZIP}' -DestinationPath '${HS_DIR}' -Force`], { stdio: 'inherit' })
}
writeFileSync(HS_VERSION_FILE, stable.version)
rmSync(ZIP, { force: true })
console.log('完成：', stable.version, '→', HS_EXE)
console.log('回退：把 chrome-headless-shell-win64.bak-* 改回原名即可')
