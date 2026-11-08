// 文档链接体检：相对 .md 链接必须真的存在。
// 用法：node .github/scripts/check-doc-links.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const md = []
for (const f of readdirSync('.')) if (f.endsWith('.md')) md.push(f)
for (const f of readdirSync('docs')) if (f.endsWith('.md')) md.push('docs/' + f)

const bad = []
const external = []
for (const file of md) {
  const text = readFileSync(file, 'utf8')
  // [文字](目标) —— 只查本地 .md，跳过 http(s)、锚点、图片
  for (const m of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[1]
    if (/^(https?:|mailto:|#)/.test(href)) { if (href.startsWith('http')) external.push(file + ' → ' + href); continue }
    if (!href.endsWith('.md') && !href.endsWith('.md#') && !/\.md#/.test(href)) continue
    const target = normalize(join(dirname(file), href.split('#')[0]))
    if (!existsSync(target)) bad.push(`${file} → ${href}`)
  }
}

if (bad.length) {
  console.error('坏链接：')
  for (const b of bad) console.error(' ❌ ' + b)
  process.exit(1)
}
console.log(`✅ ${md.length} 个 md 文件的本地链接全部可达（外链 ${external.length} 条未校验）`)
