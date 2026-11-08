// 一条命令自检：语法/注册/加密/联网/浏览器/填表/验证码/关窗。全绿才算能用。
const t0 = Date.now()
const steps = []
const step = async (name, fn) => {
  try { const v = await fn(); steps.push([true, name, v]) }
  catch (e) { steps.push([false, name, String(e?.message || e)]) }
}
const reg = []
await step('模块导入 + apply 注册', async () => {
  const mod = await import('./index.js')
  mod.apply({ tools: { register: (d) => reg.push(d) } })
  return `${reg.length} 个工具`
})
await step('参数 schema 与 defineTool 等价', async () => {
  const { defineTool } = await import('file:///Y:/07_AI%E6%A8%A1%E5%9E%8B/dsh/resources/app/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js')
  const norm = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v))
  let ok = 0
  for (const t of reg) {
    const req = new Set(t.parameters.required || [])
    const spec = Object.fromEntries(Object.entries(t.parameters.properties).map(([k, v]) => [k, req.has(k) ? { ...v, required: true } : v]))
    const c = defineTool({ name: t.name, description: t.description, parameters: spec, output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: () => [] }, execute: async () => ({}) })
    const a = norm({ type: 'object', properties: t.parameters.properties, required: [...req].sort() })
    const b = norm({ type: 'object', properties: c.parameters.properties, required: [...(c.parameters.required || [])].sort() })
    if (a !== b) throw new Error(`${t.name} 不一致`)
    ok++
  }
  return `${ok}/${reg.length}`
})
await step('凭据库 DPAPI 加解密', async () => {
  const core = await import('./core.js')
  const v = await core.loadVault()
  v.accounts.__check = { username: 'u', password: 'p', savedAt: new Date().toISOString() }
  const s = await core.saveVault(v)
  const back = await core.loadVault()
  const ok = back.accounts.__check?.password === 'p'
  delete back.accounts.__check
  await core.saveVault(back)
  return `dpapi=${s.dpapi} 回读=${ok}`
})
await step('明文不落盘', async () => {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile((await import('./core.js')).VAULT, 'utf8')
  if (raw.includes('"p"')) throw new Error('疑似明文')
  return 'cipher-only'
})
await step('联网探针（书屋）', async () => {
  const core = await import('./core.js')
  const p = await core.probeSite('alicesw', [])
  if (p.status !== 200) throw new Error(JSON.stringify(p))
  return `status=${p.status}`
})
await step('浏览器开→导航→填表→验证码→关', async () => {
  const core = await import('./core.js')
  const html = encodeURIComponent('<html><body><form><input name="account"><input type="password" name="pass"><input name="vcode"><img alt="captcha" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"><button>登录</button></form></body></html>')
  await core.launchBrowser('about:blank')
  await core.goto('data:text/html;charset=utf-8,' + html)
  const f = await core.autofill('alice', 's3cret')
  if (!f.ok || !f.needCaptcha) throw new Error('填表/验证码识别失败: ' + JSON.stringify(f))
  const cap = await core.captchaTo(core.ROOT + '/shots/check-captcha.png')
  if (!cap.found) throw new Error('验证码截图失败')
  const closed = await core.closeBrowser()
  return `fill=ok captcha=${cap.bytes}B closed=${closed.closed}`
})
await step('我自己的浏览器（Chrome for Testing）', async () => {
  const core = await import('./core.js')
  const { stat } = await import('node:fs/promises')
  const ok = await stat(core.CFT_EXE).then(() => true).catch(() => false)
  if (!ok) throw new Error('未安装：跑 auth_browser_install')
  const b = await core.launchBrowser('about:blank')
  const v = await (await fetch('http://127.0.0.1:' + b.port + '/json/version')).json()
  await core.closeBrowser()
  return v.Browser
})
await step('Edge 密码库可读（只读计数）', async () => {
  const { listLogins } = await import('./edge_creds.js')
  const rows = await listLogins({ browser: 'edge' })
  const v20 = rows.filter((r) => r.scheme.startsWith('v20')).length
  if (!rows.length) throw new Error('没读到条目')
  return rows.length + ' 条，v20 ' + v20 + ' 条'
})

await step('browser_* 动作层（快照/点击/拒填密码/凭据填充）', async () => {
  const core = await import('./core.js')
  const B = await import('./browser.js')
  core.setBrowserExe(core.CFT_EXE); core.setProfileDir(core.ROOT + '/nl-check-' + Date.now())
  const html = encodeURIComponent('<html><body><form><input name="account"><input type="password" name="pass"><button>登录</button></form></body></html>')
  await core.launchBrowser('about:blank')
  await core.goto('data:text/html;charset=utf-8,' + html)
  const snap = await B.snapshot({ maxText: 200 })
  if (!snap.elements || !snap.elements.length) throw new Error('快照没元素')
  const pw = snap.elements.find((e) => e.kind === 'input:password')
  const refused = await B.typeInto(pw.ref, 'x')
  if (refused.ok) throw new Error('密码框没被拒填')
  const btn = snap.elements.find((e) => e.label === '登录')
  const clicked = await B.click(btn.ref)
  const shot = await B.screenshot('.dsh-login/check.png')
  await core.closeBrowser()
  return 'refs=' + snap.count + ' click=' + clicked.ok + ' refused=ok png=' + shot.bytes + 'B'
})

await step('设置页：client 半身 + 本地 API', async () => {
  const { readFileSync } = await import('node:fs')
  const pj = JSON.parse(readFileSync('package.json', 'utf8'))
  if (pj.dsh?.client?.platform !== 'web') throw new Error('package.json 缺 dsh.client')
  const client = readFileSync('client.js', 'utf8')
  if (!client.includes("ctx.slots.inject('settings.section'")) throw new Error('client 没注册 settings.section')
  const http = await import('node:http')
  const { createApi } = await import('./api.js')
  const srv = http.createServer(createApi())
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  const j = await (await fetch('http://127.0.0.1:' + port + '/api/yunpa/status')).json()
  srv.close()
  if (!j.ok) throw new Error('API 返回异常')
  return 'slot=settings.section api=/api/yunpa/status sites=' + (j.sites || []).length
})

await step('插件页可见性（dependencies / bundles / 显示名 / 图标）', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')
  const PROFILE = process.env.DSH_PROFILE || join(homedir(), '.dsh', 'profiles', 'desktop')
  const pkgFile = join(PROFILE, 'package.json')
  if (!existsSync(pkgFile)) throw new Error('profile 不存在: ' + PROFILE)
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  const me = JSON.parse(readFileSync('package.json', 'utf8'))
  const dep = pkg.dependencies?.[me.name]
  if (!dep) throw new Error('dependencies 缺 ' + me.name + ' → 插件页不会列出它（跑 node install.mjs）')
  if (!(pkg.dsh?.profile?.bundles || []).includes(me.name)) throw new Error('bundles 缺 ' + me.name + ' → 不会挂载')
  const zh = JSON.parse(readFileSync(join('locale', 'zh.json'), 'utf8'))
  if (!zh.meta?.title) throw new Error('locale/zh.json 缺 meta.title → 插件页只会显示包名')
  if (!me.icon || !existsSync(me.icon)) throw new Error('package.json 的 icon 缺失或文件不在包里')
  const yml = readFileSync(join(PROFILE, 'cordis.yml'), 'utf8')
  const n = yml.split('\n').filter((l) => l.trim() === '- id: yunpa').length
  if (n !== 1) throw new Error(`cordis.yml 有 ${n} 条 yunpa 条目，应为 1（重复会让开关互相覆盖）`)
  return `dep=${dep} 显示名=${zh.meta.title} icon=${me.icon}`
})

await step('隐私：硬化后无外部连接', async () => {
  const { execFileSync } = await import('node:child_process')
  const core = await import('./core.js')
  // 只清掉本插件 profile 起的进程，不碰用户自己的浏览器
  await core.killOwnBrowser()
  await new Promise((r) => setTimeout(r, 1500))
  core.setBrowserExe(core.CFT_EXE); core.setProfileDir(core.ROOT + '/edge-profile')
  const b = await core.launchBrowser('about:blank')
  await new Promise((r) => setTimeout(r, 6000))
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    "$ids=(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\").ProcessId; " +
    "Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess -and $_.RemoteAddress -notmatch '^(127\.|::1$)' } | Measure-Object | Select-Object -ExpandProperty Count",
  ], { encoding: 'utf8' }).trim()
  await core.closeBrowser()
  const n = parseInt(out, 10) || 0
  if (n > 0) throw new Error('仍有 ' + n + ' 条外部连接（可能是 Chrome 版本回退导致拦截失效）')
  return '外部连接 0（拦截 ' + core.BLOCKED_HOSTS.length + ' 个 Google 后台域名）'
})

await step('设置页六页签渲染（含浏览器页）', async () => {
  // 进程内跑，省一次 node 启动
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync('node', ['verify-ui.mjs'], { encoding: 'utf8' })
  const okLines = (out.match(/✅/g) || []).length
  if (okLines < 6) throw new Error('只有 ' + okLines + ' 个页签通过')
  return okLines + ' 个页签'
})

const bad = steps.filter(([ok]) => !ok)
for (const [ok, name, info] of steps) console.log(`${ok ? '✅' : '❌'} ${name} :: ${info}`)
console.log(`\n${bad.length ? '有 ' + bad.length + ' 项失败' : '全部通过'} (${Date.now() - t0}ms)`)
process.exit(bad.length ? 1 : 0)
