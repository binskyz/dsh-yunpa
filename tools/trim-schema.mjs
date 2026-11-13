// 一次性：删掉 parameters.OBJ({...}) 里属性级的 description，压缩 schema
// 注意跨行写法：属性可能写成 `site: {\n type,\n required,\n description: '…',\n }`，
// 只删片段会留下孤立的逗号 → 语法错。所以「独占一行的 description」和「删完只剩逗号的行」整行删除。
import { readFileSync, writeFileSync } from 'node:fs'

const p = 'index.js'
const src = readFileSync(p, 'utf8')
const before = src.length
const lines = src.split('\n')
const INLINE = /,?\s*description:\s*'(?:[^'\\]|\\.)*'/
const ONLY = /^description:\s*'(?:[^'\\]|\\.)*',?$/

let inObj = false
let removed = 0
const out = []
for (const line of lines) {
  if (line.includes('parameters: OBJ({')) { inObj = true; out.push(line); continue }
  if (inObj && /^\s*\}, \[/.test(line)) { inObj = false; out.push(line); continue }
  if (inObj && line.includes('description:')) {
    if (ONLY.test(line.trim())) { removed++; continue }        // 独占一行 → 整行删
    const next = line.replace(INLINE, '')
    if (next !== line) {
      removed++
      if (/^\s*,?\s*$/.test(next)) continue                    // 删完只剩逗号 → 整行删
      out.push(next); continue
    }
  }
  out.push(line)
}
const txt = out.join('\n')
writeFileSync(p, txt, 'utf8')
console.log('删掉属性级 description:', removed, '处 |', before, '→', txt.length, '字符')
