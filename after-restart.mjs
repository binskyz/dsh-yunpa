// 重启 DSH 之后的交互验收：只查"加载了没有、能不能跑"，不改任何东西
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const rows = []
const add = (ok, name, info = '') => rows.push([ok, name, info])
const PROFILE = join(homedir(), '.dsh', 'profiles', 'desktop')

// 1) 插件是否被写进有效配置
try {
  const yml = readFileSync(join(PROFILE, 'cordis.yml'), 'utf8')
  const hit = yml.includes('name: dsh-yunpa')
  add(hit, 'cordis.yml 已加载 dsh-yunpa', hit ? '' : '重启后仍未出现 → 检查 cordis.patch.yml 的 insert')
} catch (e) { add(false, 'cordis.yml 可读', String(e.message)) }

// 2) 磁盘上的插件版本
try {
  const pj = JSON.parse(readFileSync(join(PROFILE, 'node_modules', 'dsh-yunpa', 'package.json'), 'utf8'))
  const src = JSON.parse(readFileSync(join(homedir(), '.dsh', 'plugins-local', 'dsh-yunpa', 'package.json'), 'utf8'))
  add(pj.version === src.version, 'profile 内插件版本', `v${pj.version} / 本源 v${src.version}`)
} catch (e) { add(false, '插件目录', String(e.message)) }

// 3) 数据目录与加密库
const core = await import(pathToFileURL(join(PROFILE, 'node_modules', 'dsh-yunpa', 'core.js')).href)
try {
  const v = await core.loadVault()
  const raw = readFileSync(core.VAULT, 'utf8')
  add(JSON.parse(raw).wrappedKey !== null, '凭据库 DPAPI 包裹', Object.keys(v.accounts).length + ' 组账号')
  add(!existsSync(core.KEYFILE), '无裸密钥残留')
} catch (e) { add(false, '凭据库', String(e.message)) }

// 4) 无头浏览器起得来
try {
  const b = await core.launchBrowser('about:blank')
  const ver = await (await fetch(`http://127.0.0.1:${b.port}/json/version`)).json()
  add(/Headless/.test(ver.Browser), '无头浏览器', ver.Browser)
  add((await core.killOwnBrowser()) >= 0, '按 profile 关浏览器')
} catch (e) { add(false, '浏览器', String(e.message)) }

// 5) 设置页 API 处理器可用
try {
  const http = await import('node:http')
  const { createApi } = await import(pathToFileURL(join(PROFILE, 'node_modules', 'dsh-yunpa', 'api.js')).href)
  const srv = http.createServer(createApi())
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const j = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/yunpa/status`)).json()
  srv.close()
  add(j.ok === true, '设置页 API /status', (j.sites || []).length + ' 个站点')
} catch (e) { add(false, '设置页 API', String(e.message)) }

// 6) 审计日志可写
try {
  await core.audit('acceptance', { by: 'after-restart.mjs' })
  const lines = readFileSync(join(core.ROOT, 'audit.jsonl'), 'utf8').trim().split('\n')
  add(lines.length > 0, '审计日志', lines.length + ' 条')
} catch (e) { add(false, '审计日志', String(e.message)) }

for (const [ok, n, i] of rows) console.log(`${ok ? '✅' : '❌'} ${n}${i ? ' :: ' + i : ''}`)
const bad = rows.filter(([o]) => !o).length
console.log(bad ? `\n${bad} 项不通过` : '\n重启后验收通过，可以去设置页点一遍了')
process.exit(bad ? 1 : 0)
