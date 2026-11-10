// 一条命令把「云爬」装到位 / 修到位。幂等：跑几次结果一样。
//   node install.mjs            体检 + 修复（改文件前自动备份）
//   node install.mjs --check    只体检，一个字都不改
//   node install.mjs --force    连 node_modules 里的实体副本也换成目录联接
//   node install.mjs --profile <dir>
//
// 装一个 DSH 插件要四件事，少一件就是「跑了但看不见」或「装了不跑」：
//   ① 包目录          ② profile/package.json dependencies 登记（决定插件页列不列）
//   ③ dsh.profile.bundles 加包名（决定加载器挂不挂）  ④ 包内 cordis.patch.yml 的 insert
import { existsSync, readFileSync, writeFileSync, copyFileSync, lstatSync, realpathSync, symlinkSync, renameSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SRC = dirname(fileURLToPath(import.meta.url))
const NAME = 'dsh-yunpa'
const ENTRY = 'yunpa'
const argv = process.argv.slice(2)
const flag = (k) => argv.includes('--' + k)
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const CHECK_ONLY = flag('check')
const FORCE = flag('force')
const PROFILE = resolve(opt('profile') || process.env.DSH_PROFILE || join(homedir(), '.dsh', 'profiles', 'desktop'))
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')

const rows = []
const rec = (ok, name, info, fixable) => rows.push({ ok, name, info: info || '', fixable: !!fixable })
const backup = (file) => { const b = `${file}.bak-${stamp}`; copyFileSync(file, b); return b }

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}
function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

// ── 0. 基本前提 ───────────────────────────────────────────────
rec(existsSync(join(SRC, 'package.json')), '本源目录可读', SRC)
const pkgFile = join(PROFILE, 'package.json')
rec(existsSync(pkgFile), 'profile 存在', PROFILE)
if (!existsSync(pkgFile)) {
  for (const r of rows) console.log(`${r.ok ? '✅' : '❌'} ${r.name} :: ${r.info}`)
  process.exit(1)
}
const pkg = readJson(pkgFile)
const mine = readJson(join(SRC, 'package.json'))
const depSpec = 'file:' + SRC.replace(/\\/g, '/')

// ── 1. dependencies：插件页列不列就看这里 ─────────────────────
const depOk = pkg.dependencies && pkg.dependencies[NAME] !== undefined
rec(depOk, 'package.json dependencies 已登记', depOk ? pkg.dependencies[NAME] : `缺 ${NAME} → 插件页会「查无此人」`, !depOk)

// ── 2. bundles：加载器挂不挂 ─────────────────────────────────
const bundles = pkg.dsh?.profile?.bundles
const bunOk = Array.isArray(bundles) && bundles.includes(NAME)
rec(bunOk, 'dsh.profile.bundles 已包含', bunOk ? NAME : '缺 → 不会挂载', !bunOk)

// ── 3. node_modules：真源只有一份，其余都是链接 ───────────────
const target = join(PROFILE, 'node_modules', NAME)
let linkOk = false
let linkInfo = '不存在'
try {
  const st = lstatSync(target)
  if (st.isSymbolicLink()) {
    // 悬空链接：目标被删了。lstat 能看到链接本身，realpath 会抛错——
    // 这种情况最隐蔽：文件看起来「在」，加载时才炸，所以单独报出来并允许直接重连。
    let real = null
    try { real = realpathSync(target) } catch { real = null }
    if (real === null) {
      linkOk = false
      linkInfo = '悬空链接（指向的目标已不存在）→ 会自动重连'
    } else {
      linkOk = resolve(real).toLowerCase() === resolve(SRC).toLowerCase()
      linkInfo = linkOk ? '→ ' + real : '链到别处：' + real
    }
  } else {
    const realFile = join(target, 'package.json')
    const same = existsSync(realFile) && readJson(realFile).version === mine.version
    linkInfo = same ? '实体副本（版本一致，改用联接才能只改一处）' : '实体副本且版本不一致'
    linkOk = false
  }
} catch (e) { linkInfo = String(e.message) }
rec(linkOk, 'node_modules 指向本源', linkInfo, !linkOk)

// ── 4. cordis.yml：恰好一条 insert ───────────────────────────
const ymlFile = join(PROFILE, 'cordis.yml')
let ymlHits = 0
try {
  ymlHits = readFileSync(ymlFile, 'utf8').split('\n').filter((l) => l.trim() === `- id: ${ENTRY}`).length
} catch (e) { /* 下面报 */ }
rec(ymlHits === 1, 'cordis.yml 条目数', ymlHits === 1 ? '1 条' : `${ymlHits} 条（重复会让开关互相覆盖）`, ymlHits !== 1)

// ── 5. 显示名与图标：插件页长得好不好看 ──────────────────────
let titleOk = false
let titleInfo = '缺 locale'
try {
  const zh = readJson(join(SRC, 'locale', 'zh.json'))
  titleOk = typeof zh?.meta?.title === 'string' && zh.meta.title.length > 0
  titleInfo = titleOk ? `显示名「${zh.meta.title}」` : 'locale/zh.json 缺 meta.title'
} catch (e) { titleInfo = String(e.message) }
rec(titleOk, 'locale 显示名', titleInfo, !titleOk)

const iconFile = mine.icon ? join(SRC, mine.icon) : null
const iconOk = !!iconFile && existsSync(iconFile)
rec(iconOk, 'icon 图标', iconOk ? `${mine.icon} ${readFileSync(iconFile).length}B` : 'package.json 缺 icon 或文件不存在', !iconOk)

// ── 输出体检结果 ────────────────────────────────────────────
for (const r of rows) console.log(`${r.ok ? '✅' : '❌'} ${r.name} :: ${r.info}`)
const bad = rows.filter((r) => !r.ok)
if (CHECK_ONLY || bad.length === 0) {
  console.log(`\n${bad.length ? bad.length + ' 项待修（去掉 --check 执行修复）' : '全部就绪，无需改动'}`)
  process.exit(bad.length ? 1 : 0)
}

// ── 修复 ────────────────────────────────────────────────────
console.log('\n开始修复：')
const changed = []

if (!depOk) {
  const b = backup(pkgFile)
  const next = readJson(pkgFile)
  next.dependencies = { ...(next.dependencies || {}), [NAME]: depSpec }
  writeJson(pkgFile, next)
  changed.push(`dependencies += ${NAME}: ${depSpec}（备份 ${b.split(/[\\/]/).pop()}）`)
}
if (!bunOk) {
  if (!changed.length) backup(pkgFile)
  const next = readJson(pkgFile)
  next.dsh = next.dsh || {}
  next.dsh.profile = next.dsh.profile || {}
  const list = Array.isArray(next.dsh.profile.bundles) ? next.dsh.profile.bundles : []
  if (!list.includes(NAME)) list.push(NAME)
  next.dsh.profile.bundles = list
  writeJson(pkgFile, next)
  changed.push(`bundles += ${NAME}`)
}

if (!linkOk) {
  let st = null
  if (existsSync(target)) st = lstatSync(target)
  else { try { st = lstatSync(target) } catch { st = null } }   // existsSync 对悬空链接返回 false
  const dangling = st !== null && st.isSymbolicLink() && (() => { try { realpathSync(target); return false } catch { return true } })()
  const canReplace = !st || st.isSymbolicLink() || FORCE
  if (dangling) console.log(' · 检测到悬空链接，直接重连')
  if (canReplace) {
    if (st) {
      const bak = `${target}.bak-${Date.now()}`
      renameSync(target, bak)
      changed.push(`旧 node_modules/${NAME} → ${bak.split(/[\\/]/).pop()}`)
    }
    symlinkSync(SRC, target, 'junction')
    changed.push(`node_modules/${NAME} → ${SRC}（目录联接）`)
  } else {
    changed.push(`跳过：node_modules/${NAME} 是实体目录，加 --force 才会换成联接（会先改名备份）`)
  }
}

if (ymlHits !== 1) {
  try {
    const raw = readFileSync(ymlFile, 'utf8')
    const b = backup(ymlFile)
    const lines = raw.split('\n')
    const block = [`- id: ${ENTRY}`, `  name: ${NAME}`, '  config: {}']
    const hits = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === `- id: ${ENTRY}`) hits.push(i)
    }
    if (hits.length > 1) {
      const drop = new Set()
      for (const i of hits.slice(1)) {
        drop.add(i)
        if (lines[i + 1]?.trim() === `name: ${NAME}`) drop.add(i + 1)
        if (lines[i + 2]?.trim() === 'config: {}') drop.add(i + 2)
      }
      writeFileSync(ymlFile, lines.filter((_, i) => !drop.has(i)).join('\n'), 'utf8')
      changed.push(`cordis.yml 去掉 ${hits.length - 1} 条重复 insert（备份 ${b.split(/[\\/]/).pop()}）`)
    } else if (hits.length === 0) {
      writeFileSync(ymlFile, raw.replace(/\n?$/, '\n') + block.join('\n') + '\n', 'utf8')
      changed.push(`cordis.yml 补 1 条 insert（备份 ${b.split(/[\\/]/).pop()}）`)
    }
  } catch (e) { changed.push('cordis.yml 修复失败：' + String(e.message)) }
}

if (!iconOk) changed.push('icon 需要手工补：package.json 的 icon 指向包内 SVG/PNG（≤256KiB）')
if (!titleOk) changed.push('显示名需要手工补：locale/zh.json 的 meta.title')

console.log(changed.length ? changed.map((c) => ' · ' + c).join('\n') : ' · 无可改动项')
console.log('\n修完重启 DSH；只想确认加载状态可以跑 node after-restart.mjs。')
