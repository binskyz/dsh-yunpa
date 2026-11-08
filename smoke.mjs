// 加载期冒烟：不联网、不开浏览器，只验证「插件挂上去会不会崩」
const problems = []
const reg = []
const injected = []
const routes = []
const mockCtx = {
  tools: { register(d) { reg.push(d) } },
  inject(deps, cb) { injected.push(deps); cb({ webServer: { register(r) { routes.push(r); return { dispose() {} } } }, effect(fn) { fn() } }) },
}
const mod = await import('./index.js')

if (typeof mod.name !== 'string') problems.push('缺少 name 导出')
if (!Array.isArray(mod.inject)) problems.push('缺少 inject 数组')
if (typeof mod.apply !== 'function') problems.push('缺少 apply 函数')

mod.apply(mockCtx)
if (!routes.some((r) => r.path === '/api/yunpa')) problems.push('设置页 API 路由没注册')
console.log('注册工具数:', reg.length, '| 注入服务:', injected.flat().join(','), '| 路由:', routes.map((r) => r.kind + ' ' + r.path).join(','))
console.log('  ', reg.map((t) => t.name).join(', '))

// 1) 形状检查
const seen = new Set()
for (const t of reg) {
  if (seen.has(t.name)) problems.push(`工具名重复: ${t.name}`)
  seen.add(t.name)
  if (!/^[a-z][a-z0-9_]*$/.test(t.name)) problems.push(`工具名不合规: ${t.name}`)
  if (typeof t.description !== 'string' || t.description.length < 10) problems.push(`${t.name} 描述过短`)
  if (typeof t.execute !== 'function') problems.push(`${t.name} 缺 execute`)
  if (t.parameters?.type !== 'object') problems.push(`${t.name} parameters 根不是 object`)
  for (const k of t.parameters?.required || []) {
    if (!(k in (t.parameters.properties || {}))) problems.push(`${t.name} required 指向不存在的字段 ${k}`)
  }
  for (const [k, v] of Object.entries(t.parameters?.properties || {})) {
    if (!v || !v.type) problems.push(`${t.name}.${k} 缺 type`)
    if ('required' in (v || {})) problems.push(`${t.name}.${k} 属性级 required 未清理`)
    if ('additionalProperties' in (v || {})) problems.push(`${t.name}.${k} 带了 additionalProperties`)
  }
  if (!t.output?.schema || typeof t.output?.render !== 'function') problems.push(`${t.name} output 形状不对`)
}

// 2) 与 DSH 自带 defineTool 的产物做等价比对（它吃 property-map 规格）
try {
  const { defineTool } = await import('file:///Y:/07_AI%E6%A8%A1%E5%9E%8B/dsh/resources/app/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js')
  const canon = (v) => JSON.stringify(v, Object.keys(v || {}).sort())
  let same = 0
  for (const t of reg) {
    const spec = {}
    const req = new Set(t.parameters.required || [])
    for (const [k, v] of Object.entries(t.parameters.properties || {})) spec[k] = req.has(k) ? { ...v, required: true } : v
    let compiled
    try { compiled = defineTool({ name: t.name, description: t.description, parameters: spec, output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: () => [] }, execute: async () => ({}) }) }
    catch (e) { problems.push(`defineTool(${t.name}) 抛错: ${e.message}`); continue }
    const norm = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v))
    const A = norm({ type: 'object', properties: t.parameters.properties, required: [...(t.parameters.required || [])].sort() })
    const B = norm({ type: 'object', properties: compiled.parameters.properties, required: [...(compiled.parameters.required || [])].sort() })
    if (A === B) same++
    else problems.push(`${t.name} schema 与 defineTool 产物不一致\n  mine=${A}\n  dsh =${B}`)
  }
  console.log('与 defineTool 等价:', same, '/', reg.length)
} catch (e) {
  console.log('跳过 defineTool 比对:', String(e.message).slice(0, 80))
}

// 3) 工具名不能撞 DSH 内置工具
const builtin = ['bash', 'pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'present', 'skill', 'subagent', 'workflow', 'todo_write', 'web_fetch', 'web_search', 'ask_user_question', 'schedule_create', 'schedule_list', 'read_image']
for (const t of reg) if (builtin.includes(t.name)) problems.push(`工具名撞内置: ${t.name}`)

// 4) 干跑一个不联网的工具，确认异常被 guard 吞掉
const st = reg.find((t) => t.name === 'auth_status')
try {
  const r = await st.execute({ probe: false })
  console.log('auth_status 干跑 ok:', JSON.stringify(r).slice(0, 120))
} catch (e) { problems.push('auth_status 干跑抛异常: ' + e.message) }

console.log(problems.length ? '❌ 问题:\n' + problems.join('\n') : '✅ 加载期冒烟全部通过')
process.exit(problems.length ? 1 : 0)
