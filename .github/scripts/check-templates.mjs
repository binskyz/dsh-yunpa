// 模板体检：不装 YAML 库，只查 GitHub 一定会拒的那几件事。
// 用法：node .github/scripts/check-templates.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const root = '.github'
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (['.yml', '.yaml'].includes(extname(entry.name))) files.push(p.replace(/\\/g, '/'))
  }
}
walk(root)

const problems = []
const TOP_KEYS = ['name', 'on', 'permissions', 'jobs', 'env', 'concurrency', 'defaults',
  'blank_issues_enabled', 'contact_links', 'body', 'title', 'labels', 'description', 'assignees', 'about', 'url']

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (text.includes('\t')) problems.push(`${file}: 含 tab（YAML 只认空格）`)
  if (text.includes('\r')) problems.push(`${file}: CRLF 换行（模板统一用 LF，建议 .gitattributes 处理）`)

  const lines = text.split('\n')
  const first = lines.find((l) => l.trim() && !l.trim().startsWith('#'))
  const key = first?.match(/^([A-Za-z_][\w-]*):/)?.[1]
  if (!key) problems.push(`${file}: 首个非注释行不是顶层键`)
  else if (!TOP_KEYS.includes(key)) problems.push(`${file}: 顶层键 "${key}" 不在白名单里`)

  // issue form：body 下每个列表项都必须有 type
  if (file.includes('ISSUE_TEMPLATE') && key === 'name') {
    if (file.includes('config')) continue
    if (!/^body:/m.test(text)) problems.push(`${file}: issue form 缺 body`)
    const bodyPart = text.split(/^body:/m)[1] || ''
    const items = bodyPart.split(/\n(?=  - type:)/).slice(1)
    if (!items.length) problems.push(`${file}: body 下没有条目`)
    for (const item of items) {
      const type = item.match(/type:\s*([a-z_]+)/)?.[1]
      if (!type) problems.push(`${file}: 有条目缺 type`)
      else if (!['markdown', 'input', 'textarea', 'dropdown', 'checkboxes', 'upload'].includes(type)) {
        problems.push(`${file}: 未知 type "${type}"`)
      }
      if (type && type !== 'markdown') {
        const hasId = /id:\s*[\w-]+/.test(item)
        const hasLabel = /label:/.test(item)
        if (!hasId) problems.push(`${file}: ${type} 条目缺 id`)
        if (!hasLabel) problems.push(`${file}: ${type} 条目缺 label`)
      }
    }
  }
}

// PR 模板与 SECURITY/CONTRIBUTING 的存在性
const needs = ['PULL_REQUEST_TEMPLATE.md']
for (const n of needs) {
  if (!files.some((f) => f.endsWith(n)) && !readdirSync(root).includes(n)) problems.push(`.github/${n} 缺失`)
}

if (problems.length) {
  console.error('模板有问题：')
  for (const p of problems) console.error(' ❌ ' + p)
  process.exit(1)
}
console.log(`✅ ${files.length} 个 YAML 模板通过体检`)
for (const f of files) console.log('   ' + f)
