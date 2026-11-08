// 崩溃还原：把插件从加载树里摘掉，或反过来装回去。
//   node recover.mjs            注释掉 profile 里 dsh-yunpa 的挂载（两份配置都处理，各自备份）
//   node recover.mjs --restore  从最新的 .bak-recover-* 恢复回去
//   node recover.mjs --purge    再把 node_modules/dsh-yunpa 改名禁用（最彻底，回滚时改回来即可）
//   node recover.mjs --status   只报告当前是启用还是禁用
//
// 设计前提：DSH 起不来时你没有任何工具可用，所以这个脚本只用 node 内置模块，
// 不 import 插件自己的 core.js（那可能正是坏的）。
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync, readdirSync, lstatSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

const argv = process.argv.slice(2)
const has = (k) => argv.includes('--' + k)
const PROFILE = process.env.DSH_PROFILE || join(homedir(), '.dsh', 'profiles', 'desktop')
const PKG = 'dsh-yunpa'
const ENTRY = 'yunpa'
const FILES = ['cordis.patch.yml', 'cordis.yml']
const ts = () => new Date().toISOString().replace(/[:.]/g, '-')

const backupOf = (file) => `${file}.bak-recover-${ts()}`

/** cordis.yml：`- id: yunpa` 起的三行。 */
function commentCordisYml(text) {
  const lines = text.split('\n')
  let hit = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== `- id: ${ENTRY}`) continue
    hit++
    for (let j = i; j < lines.length && j < i + 4; j++) {
      if (j > i && lines[j].trim() === '' ) break
      if (j > i && /^\s*- /.test(lines[j]) && j > i + 1) break
      if (!lines[j].startsWith('#')) lines[j] = '# ' + lines[j]
    }
  }
  return { text: lines.join('\n'), hit }
}

/** cordis.patch.yml：整块 `- insert:` 里只有 yunpa 时，连 insert 一起注释。 */
function commentPatchYml(text) {
  const lines = text.split('\n')
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('- insert:')) {
      let end = i + 1
      while (end < lines.length && !(lines[end].startsWith('- ') && !/^\s+- /.test(lines[end]))) end++
      blocks.push([i, end])
    }
  }
  let hit = 0
  const drop = new Set()
  for (const [start, end] of blocks) {
    const body = lines.slice(start, end).join('\n')
    if (!body.includes(PKG)) continue
    const names = [...body.matchAll(/name:\s*'?"?([\w@/.-]+)'?"?/g)].map((m) => m[1])
    if (names.some((n) => n !== PKG)) continue // 同一 insert 里还有别的插件，手工处理更安全
    hit++
    for (let i = start; i < end; i++) drop.add(i)
  }
  for (const i of drop) if (!lines[i].startsWith('#')) lines[i] = '# ' + lines[i]
  return { text: lines.join('\n'), hit }
}

function status() {
  const rows = []
  for (const f of FILES) {
    const p = join(PROFILE, f)
    if (!existsSync(p)) { rows.push([f, '不存在']); continue }
    const t = readFileSync(p, 'utf8')
    const active = f === 'cordis.yml'
      ? t.split('\n').some((l) => l.trim() === `- id: ${ENTRY}`)
      : (() => {
        // patch 文件：看哪一个 `- insert:` 块真正包含本包（块边界同 commentPatchYml）
        const lines = t.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].startsWith('- insert:')) continue
          let end = i + 1
          while (end < lines.length && !(lines[end].startsWith('- ') && !/^\s+- /.test(lines[end]))) end++
          if (lines.slice(i, end).join('\n').includes(PKG)) return true
        }
        return false
      })()
    rows.push([f, active ? '启用（有挂载）' : '已禁用（无挂载）'])
  }
  const nm = join(PROFILE, 'node_modules', PKG)
  rows.push(['node_modules/' + PKG, existsSync(nm) ? (lstatSync(nm).isSymbolicLink() ? '存在（联接）' : '存在（实体）') : '不存在'])
  for (const [k, v] of rows) console.log(`  ${k.padEnd(24)} ${v}`)
  return rows
}

if (has('status')) { status(); process.exit(0) }

if (has('restore')) {
  let done = 0
  for (const f of FILES) {
    const p = join(PROFILE, f)
    if (!existsSync(p)) continue
    const baks = readdirSync(PROFILE).filter((n) => n.startsWith(f + '.bak-recover-')).sort()
    if (!baks.length) { console.log(`  ${f}: 没有备份可恢复`); continue }
    const latest = baks[baks.length - 1]
    copyFileSync(join(PROFILE, latest), p)
    console.log(`  ${f}: 已从 ${latest} 恢复`)
    done++
  }
  process.exit(done ? 0 : 1)
}

let changed = 0
for (const f of FILES) {
  const p = join(PROFILE, f)
  if (!existsSync(p)) continue
  const before = readFileSync(p, 'utf8')
  const r = f === 'cordis.yml' ? commentCordisYml(before) : commentPatchYml(before)
  if (!r.hit || r.text === before) { console.log(`  ${f}: 无需改动（未找到 ${PKG} 挂载）`); continue }
  const bak = backupOf(p)
  copyFileSync(p, bak)
  writeFileSync(p, r.text, 'utf8')
  console.log(`  ${f}: 已禁用 ${r.hit} 处挂载，备份 ${basename(bak)}`)
  changed++
}

if (has('purge')) {
  const nm = join(PROFILE, 'node_modules', PKG)
  if (existsSync(nm)) {
    const dead = nm + '.disabled-' + ts()
    renameSync(nm, dead)
    console.log(`  node_modules/${PKG}: 已改名为 ${basename(dead)}`)
    changed++
  }
}

console.log(changed ? '\n改完重启 DSH。回滚：node recover.mjs --restore' : '\n没有任何改动')
process.exit(changed ? 0 : 1)
