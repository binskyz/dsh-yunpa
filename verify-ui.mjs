// 四个页签的渲染回归：stub React，逐页断言关键文案
let cap = null
global.window = { __ModuleLoader__: { load: (c) => { cap = c } } }
global.document = { querySelector: () => null, createElement: () => ({ dataset: {}, set textContent(v) {}, appendChild() {} }), head: { appendChild() {} } }
global.fetch = async () => ({ json: async () => ({ ok: true, entries: [], sites: {} }) })

await import('./client.js')
const stub = {
  createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c.flat() }),
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useId: () => 'x',
}
const mod = cap.factory((n) => { if (n === 'react') return stub; throw new Error(n) })
const Page = mod.__Page
if (!Page) { console.log('❌ 没有导出 __Page'); process.exit(1) }

const text = (node) => {
  const out = []
  const walk = (n) => {
    if (n == null) return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n === 'object') { if (typeof n.type === 'function') return walk(n.type(n.props)); walk(n.children); walk(n.props?.children); return }
    out.push(String(n))
  }
  walk(node)
  return out.join(' ')
}

const expect = {
  overview: ['受控浏览器', '启动浏览器', '审计 / 崩溃', '凭据库', '云爬'],
  vault: ['凭据库是空的'],
  edge: ['读取中…'],
  sites: ['加站点', '读取中…'],
  diag: ['刷新日志', '数据目录', '接口：/api/yunpa'],
}
let bad = 0
for (const [tab, words] of Object.entries(expect)) {
  const t = text(stub.createElement(Page, { initialTab: tab }))
  const miss = words.filter((w) => !t.includes(w))
  if (miss.length) { bad++; console.log(`❌ ${tab} 缺: ${miss.join(', ')}`) }
  else console.log(`✅ ${tab} :: ${words.length} 个断言`)
}
console.log(bad ? `\n${bad} 个页签不通过` : '\n四个页签渲染通过')
process.exit(bad ? 1 : 0)
