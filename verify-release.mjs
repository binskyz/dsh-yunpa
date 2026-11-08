// 发布验收：不看主观，只查可判定的项。全绿才算能发。
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const checks = []
const ok = (name, extra = '') => checks.push([true, name, extra])
const bad = (name, why) => checks.push([false, name, why])

// 1) 必备文件
const need = ['package.json', 'LICENSE', 'README.md', 'README.en.md', 'CHANGELOG.md', '.gitignore',
  'index.js', 'core.js', 'api.js', 'browser.js', 'client.js', 'check-all.mjs', 'cordis.patch.yml', 'docs/安全审计.md',
  // 发布配套：安装器、图标、站点表、社区文档、GitHub 模板与工作流
  'install.mjs', 'recover.mjs', 'publish.mjs', 'icon.svg', 'sites.json', 'SECURITY.md', 'CONTRIBUTING.md', '.gitattributes',
  'locale/en.json', 'locale/zh.json', 'docs/发布清单.md',
  '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml', '.github/ISSUE_TEMPLATE/config.yml',
  '.github/workflows/ci.yml', '.github/workflows/release.yml']
const missing = need.filter((f) => !existsSync(f))
missing.length ? bad('必备文件', '缺 ' + missing.join(',')) : ok('必备文件', need.length + ' 个')

// 2) package.json 元数据
const pj = JSON.parse(readFileSync('package.json', 'utf8'))
const fields = ['name', 'version', 'description', 'license', 'repository', 'engines', 'files', 'keywords']
const lack = fields.filter((f) => !pj[f])
lack.length ? bad('package.json 元数据', '缺 ' + lack.join(',')) : ok('package.json 元数据', 'v' + pj.version)
if (!pj.dsh?.client || !pj.dsh?.bundle) bad('dsh 双半身声明', '缺 dsh.client / dsh.bundle'); else ok('dsh 双半身声明')

// 3) 敏感文件不得入库
const dirty = readdirSync('.').filter((f) => /^(vault\.bin|key\.bin|api-token\.txt|audit\.jsonl)$/.test(f)
  || (/^netlog/.test(f) && f.endsWith('.json')) || f.endsWith('.bak') || /^(cft|hs|edge-profile|pw-profile|shots)$/.test(f))
const gi = readFileSync('.gitignore', 'utf8')
const uncovered = dirty.filter((f) => !gi.includes(f.replace(/\.json$/, '*.json').replace(/-\d+$/, '')))
uncovered.length ? bad('.gitignore 覆盖', '未覆盖 ' + uncovered.join(',')) : ok('.gitignore 覆盖', dirty.length + ' 个产物已被忽略')

// 4) 明文凭据扫描（仓库文件里不该出现密码/密钥字面量）
const files = readdirSync('.').filter((f) => /\.(js|mjs|json|md|yml)$/.test(f))
const hits = []
for (const f of files) {
  const t = readFileSync(f, 'utf8')
  if (/("password"\s*:\s*"[^"]{6,}")|(BDUSS=[A-Za-z0-9]{20,})|(sk-[A-Za-z0-9]{20,})/.test(t)) hits.push(f)
}
hits.length ? bad('明文凭据扫描', '命中 ' + hits.join(',')) : ok('明文凭据扫描', files.length + ' 个文件干净')

// 5) 语法
const js = files.filter((f) => /\.(js|mjs)$/.test(f))
let syn = 0
for (const f of js) { try { execFileSync('node', ['--check', f], { stdio: 'ignore' }); syn++ } catch { bad('语法检查', f) } }
if (syn === js.length) ok('语法检查', syn + ' 个文件')

// 6) 组件导出
const mod = await import('./index.js')
if (typeof mod.apply !== 'function' || typeof mod.name !== 'string') bad('host 半身导出', '缺 name/apply'); else ok('host 半身导出', mod.name)
const clientSrc = readFileSync('client.js', 'utf8')
if (!clientSrc.includes("ctx.slots.inject('settings.section'")) bad('client 半身', '没注册 settings.section'); else ok('client 半身', 'settings.section')


// 7) 个人信息扫描：本机路径/用户名/个人书目都不该出现在仓库
const PII = ['MzEyMzY=', 'WlNZLQ==', '5ZKM5aa55aa55o2i6Lqr', '5bm75b2x5aSn5Y6m', 'NTIzMjU=']
  .map((x) => Buffer.from(x, 'base64').toString('utf8'))
  .concat([String.fromCharCode(67, 58, 92, 85, 115, 101, 114, 115), String.fromCharCode(89, 58, 92)])
const piiHits = []
for (const f of files) {
  const t = readFileSync(f, 'utf8')
  for (const k of PII) if (t.includes(k)) piiHits.push(f + ':' + k)
}
piiHits.length ? bad('个人信息扫描', piiHits.slice(0, 5).join(', ')) : ok('个人信息扫描', files.length + ' 个文件无本机路径/个人书目')

const fails = checks.filter(([o]) => !o)
for (const [o, n, e] of checks) console.log(`${o ? '✅' : '❌'} ${n} :: ${e}`)
console.log(fails.length ? `\n有 ${fails.length} 项不通过` : '\n发布验收全部通过')
process.exit(fails.length ? 1 : 0)
