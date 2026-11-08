/**
 * dsh-yunpa — 浏览器半身（设置页）
 * 手写 ModuleLoader 包：无构建步骤，只 require react。
 * 数据来自本机同源 /api/yunpa/*（由 host 半身注册在 webServer 上）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-yunpa',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback } = React
    const module = { exports: {} }
    const exports = module.exports

    const API = '/api/yunpa'
    const css = `
.nva{max-width:820px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary)}
.nva h2{margin:0;font-size:18px;font-weight:600}
.nva .intro{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px}
.nva .tabs{display:flex;gap:22px;border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:flex-end}
.nva .tab{background:0 0;border:0;padding:7px 1px 9px;font:inherit;font-size:13px;color:var(--dsw-alias-label-tertiary);cursor:pointer;position:relative}
.nva .tab[data-active=true]{color:var(--dsw-alias-label-primary)}
.nva .tab[data-active=true]:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary)}
.nva .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}
.nva .card{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.nva .card .k{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.nva .card .v{font-size:15px;font-weight:600}
.nva .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nva button.act{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer}
.nva button.act:hover{background:var(--dsw-alias-interactive-bg-hover)}
.nva button.act[disabled]{opacity:.5;cursor:default}
.nva button.pri{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.nva table{width:100%;border-collapse:collapse;font-size:13px}
.nva th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary);padding:6px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.nva td{padding:7px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.nva tr:last-child td{border-bottom:0}
.nva .mono{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;color:var(--dsw-alias-label-secondary)}
.nva .pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.nva .ok{color:var(--dsw-alias-state-success-primary,#3fb950)}
.nva .bad{color:var(--dsw-alias-state-error-primary,#f85149)}
.nva .empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:10px 0}
`
    const tagId = 'dsh-yunpa/settings.css'
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="' + tagId + '"]')) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-yunpa'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    const get = (p) => fetch(API + p, { headers: { accept: 'application/json' } }).then((r) => r.json())
    const post = (p, body) => fetch(API + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json())

    const Card = ({ k, v, tone }) => h('div', { className: 'card' },
      h('div', { className: 'k' }, k),
      h('div', { className: 'v' + (tone ? ' ' + tone : '') }, v))

    const TABS = [
      { id: 'overview', label: '概览' },
      { id: 'vault', label: '凭据库' },
      { id: 'edge', label: '密码库' },
      { id: 'sites', label: '站点' },
      { id: 'diag', label: '诊断' },
    ]

    function Page({ initialTab } = {}) {
      const [tab, setTab] = useState(initialTab || 'overview')
      const [status, setStatus] = useState(null)
      const [vault, setVault] = useState(null)
      const [edge, setEdge] = useState(null)
      const [busy, setBusy] = useState('')
      const [note, setNote] = useState('')
      const [checks, setChecks] = useState(null)
      const [sitesCfg, setSitesCfg] = useState(null)
      const [logs, setLogs] = useState(null)
      const [form, setForm] = useState({ site: '', domain: '', login: '', probe: '', marker: '' })

      const loadStatus = useCallback(() => get('/status').then(setStatus).catch((e) => setNote(String(e))), [])
      useEffect(() => { loadStatus() }, [loadStatus])
      useEffect(() => {
        const t = setInterval(() => { loadStatus() }, 10000)
        return () => clearInterval(t)
      }, [loadStatus])
      useEffect(() => {
        if (tab === 'vault' && !vault) get('/vault').then(setVault).catch((e) => setNote(String(e)))
        if (tab === 'edge' && !edge) get('/edge').then(setEdge).catch((e) => setNote(String(e)))
        if (tab === 'sites' && !sitesCfg) get('/sites').then((r) => setSitesCfg(r.sites || {})).catch((e) => setNote(String(e)))
        if (tab === 'diag' && !logs) {
          Promise.all([get('/audit?limit=10'), get('/crashes')])
            .then(([a, c]) => setLogs({ audit: a.entries || [], crash: c.entries || [] }))
            .catch((e) => setNote(String(e)))
        }
      }, [tab, vault, edge])

      const act = async (name) => {
        setBusy(name); setNote('')
        try {
          if (name === 'open' || name === 'close') {
            const r = await post('/action', { name })
            setNote(name === 'open' ? ('浏览器已启动，端口 ' + (r.port || '-')) : (r.closed ? '浏览器已关闭' : '浏览器没在运行'))
            await loadStatus()
          } else if (name === 'selfcheck') {
            const r = await post('/action', { name })
            setChecks(r.checks || [])
          } else if (name === 'refresh') {
            setVault(null); setEdge(null); await loadStatus(); setNote('已刷新')
          }
        } catch (e) { setNote(String(e)) }
        setBusy('')
      }

      const probe = async (site) => {
        setBusy('probe-' + site)
        const r = await post('/probe', { site })
        setNote(site + '：' + JSON.stringify(r.result))
        setBusy('')
      }
      const forget = async (site) => {
        setBusy('forget-' + site)
        await post('/forget', { site })
        setVault(null); await loadStatus(); setNote('已删除 ' + site)
        setBusy('')
      }

      const sites = status?.sites || []
      const accounts = vault?.accounts || []

      const overview = h('div', { className: 'grid' },
        h(Card, { k: '受控浏览器', v: status ? (status.browser?.running ? ('运行中 · ' + status.browser.port) : '未启动') : '加载中…', tone: status?.browser?.running ? 'ok' : '' }),
        h(Card, { k: '凭据库', v: (status?.sites?.filter((s) => s.account).length || 0) + ' 组账号' }),
        h(Card, { k: '登录态', v: (status?.sites?.filter((s) => s.cookies).length || 0) + ' 个站点' }),
        h(Card, { k: 'Edge 密码库', v: edge ? (edge.total + ' 条') : '点「密码库」查看' }),
        h(Card, { k: '审计 / 崩溃', v: ((status?.counts?.audit ?? 0) + ' / ' + (status?.counts?.crash ?? 0)) + ' 条' }),
        h('div', { className: 'row', style: { gridColumn: '1 / -1' } },
          h('button', { className: 'act pri', disabled: !!busy, onClick: () => act('open') }, '启动浏览器'),
          h('button', { className: 'act', disabled: !!busy, onClick: () => act('close') }, '关闭浏览器'),
          h('button', { className: 'act', disabled: !!busy, onClick: () => act('selfcheck') }, '跑自检'),
          h('button', { className: 'act', disabled: !!busy, onClick: () => act('refresh') }, '刷新')),
        sites.length === 0 ? h('div', { className: 'empty' }, '还没有站点。让 agent 说「登录贴吧」，或先把账号存进凭据库。')
          : h('table', null,
            h('thead', null, h('tr', null, ['站点', 'cookie', '账号', '更新时间', ''].map((x) => h('th', { key: x }, x)))),
            h('tbody', null, sites.map((s) => h('tr', { key: s.site },
              h('td', null, h('span', { className: 'pill' }, s.site)),
              h('td', null, String(s.cookies || 0)),
              h('td', { className: 'mono' }, s.account ? s.account.username + '（' + s.account.passwordLen + ' 位）' : '—'),
              h('td', { className: 'mono' }, s.updated ? new Date(s.updated).toLocaleString() : '—'),
              h('td', null, h('button', { className: 'act', onClick: () => probe(s.site) }, '测试')))))),
      )

      const vaultPage = accounts.length === 0 ? h('div', { className: 'empty' }, '凭据库是空的。让 agent 说「记住 NGA 的账号密码」，或从「密码库」迁移。')
        : h('table', null,
          h('thead', null, h('tr', null, ['站点', '账号', '密码', '来源', '保存时间', ''].map((x) => h('th', { key: x }, x)))),
          h('tbody', null, accounts.map((a) => h('tr', { key: a.site },
            h('td', null, h('span', { className: 'pill' }, a.site)),
            h('td', { className: 'mono' }, a.username || '—'),
            h('td', null, a.passwordLen ? (a.passwordLen + ' 位（加密存储）') : '—'),
            h('td', null, h('span', { className: 'pill' }, a.source || 'vault')),
            h('td', { className: 'mono' }, a.savedAt ? new Date(a.savedAt).toLocaleString() : '—'),
            h('td', null, h('button', { className: 'act', disabled: busy === 'forget-' + a.site, onClick: () => forget(a.site) }, '删除'))))))

      const edgePage = !edge ? h('div', { className: 'empty' }, '读取中…')
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { className: 'row' },
            h('span', { className: 'pill' }, '共 ' + edge.total + ' 条'),
            edge.cached ? h('span', { className: 'pill' }, '缓存 ' + Math.round((edge.ageMs || 0) / 1000) + 's 前') : null,
            Object.entries(edge.schemes || {}).map(([k, v]) => h('span', { className: 'pill', key: k }, k + ' ' + v)),
            h('button', { className: 'act', onClick: () => setEdge(null) }, '重新读取')),
          h('div', { className: 'empty', style: { paddingTop: 0 } },
            'v20(App-Bound) 只能由 Edge 自己解密：让 agent 调 auth_pw_open 打开该站登录页，你点一下自动填充，密码就进了加密库。'),
          h('table', null,
            h('thead', null, h('tr', null, ['站点', '账号', '密码', '加密'].map((x) => h('th', { key: x }, x)))),
            h('tbody', null, (edge.items || []).map((it) => h('tr', { key: it.host + it.username },
              h('td', { className: 'mono' }, it.host),
              h('td', { className: 'mono' }, it.username || '—'),
              h('td', null, it.passwordLen ? (it.passwordLen + ' 位') : '不可离线解密'),
              h('td', null, h('span', { className: 'pill' }, it.scheme)))))))

      const sitesPage = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        !sitesCfg ? h('div', { className: 'empty' }, '读取中…') : h('table', null,
          h('thead', null, h('tr', null, ['站点键', '域名', '探针标记', ''].map((x) => h('th', { key: x }, x)))),
          h('tbody', null, Object.entries(sitesCfg).map(([k, v]) => h('tr', { key: k },
            h('td', null, h('span', { className: 'pill' }, k)),
            h('td', { className: 'mono' }, v.domain || ''),
            h('td', { className: 'mono' }, String(v.marker || '').slice(0, 24)),
            h('td', null, h('button', {
              className: 'act', disabled: busy === 'site-del-' + k,
              onClick: async () => {
                setBusy('site-del-' + k)
                await post('/sites', { action: 'del', site: k })
                const r = await get('/sites'); setSitesCfg(r.sites || {}); setBusy('')
              },
            }, '删除')))))),
        h('div', { className: 'row', style: { marginTop: 4 } },
          ['site', 'domain', 'login', 'probe', 'marker'].map((f) => h('input', {
            key: f, placeholder: f, value: form[f],
            onChange: (e) => setForm({ ...form, [f]: e.target.value }),
            style: { padding: '5px 8px', borderRadius: 8, border: '.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', fontSize: 12, minWidth: f === 'site' ? 90 : 140 },
          })),
          h('button', {
            className: 'act pri', disabled: busy === 'site-add' || !form.site || !form.domain,
            onClick: async () => {
              setBusy('site-add')
              await post('/sites', { site: form.site, cfg: { domain: form.domain, login: form.login, probe: form.probe, marker: form.marker } })
              const r = await get('/sites'); setSitesCfg(r.sites || {}); setForm({ site: '', domain: '', login: '', probe: '', marker: '' }); setBusy('')
            },
          }, '加站点')))

      const logTable = (title, rows, cols, fmt) => h('div', null,
        h('div', { className: 'k', style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', margin: '6px 0' } }, title),
        rows.length === 0 ? h('div', { className: 'empty' }, '（空）') : h('table', null,
          h('thead', null, h('tr', null, cols.map((c) => h('th', { key: c }, c)))),
          h('tbody', null, rows.map((r, i) => h('tr', { key: i }, fmt(r).map((v, j) => h('td', { key: j, className: 'mono' }, String(v))))))))

      const diagPage = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        checks ? h('table', null,
          h('thead', null, h('tr', null, ['检查项', '结果', '说明'].map((x) => h('th', { key: x }, x)))),
          h('tbody', null, checks.map((c) => h('tr', { key: c.name },
            h('td', null, c.name),
            h('td', { className: c.ok ? 'ok' : 'bad' }, c.ok ? '通过' : '失败'),
            h('td', { className: 'mono' }, String(c.info || ''))))))
          : h('div', { className: 'empty' }, '点「跑自检」看结果'),
        h('div', { className: 'mono' }, '数据目录：' + (status?.paths?.root || '—')),
        h('div', { className: 'mono' }, '浏览器：' + (status?.browser?.exe || '未安装')),
        h('div', { className: 'mono' }, '接口：/api/yunpa/{status,vault,edge,sites,probe,forget,action,audit,crashes}'),
        h('div', { className: 'row' },
          h('button', {
            className: 'act', onClick: async () => {
              const [a, c] = await Promise.all([get('/audit?limit=10'), get('/crashes')])
              setLogs({ audit: a.entries || [], crash: c.entries || [] })
            },
          }, '刷新日志')),
        logs ? h('div', null,
          logTable('审计（最近 10 条）', logs.audit, ['时间', '动作', '站点', '详情'], (r) => [new Date(r.ts).toLocaleTimeString(), r.action, r.site || '-', JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !['ts', 'action', 'site'].includes(k)))).slice(0, 60)]),
          logTable('崩溃（最近 10 条）', logs.crash, ['时间', '来源', '信息'], (r) => [new Date(r.ts).toLocaleTimeString(), r.source, String(r.message || '').slice(0, 60)]),
        ) : h('div', { className: 'empty' }, '点「刷新日志」加载'))

      return h('div', { className: 'nva' },
        h('h2', null, '云爬'),
        h('p', { className: 'intro' }, '受控浏览器、加密凭据库与迁移来的浏览器密码。凭据只存本机（DPAPI + AES-256-GCM），不进对话。'),
        h('div', { className: 'tabs' }, TABS.map((t) => h('button', {
          key: t.id, className: 'tab', 'data-active': tab === t.id, onClick: () => setTab(t.id),
        }, t.label))),
        note ? h('div', { className: 'mono' }, note) : null,
        tab === 'overview' ? overview : tab === 'vault' ? vaultPage : tab === 'edge' ? edgePage : tab === 'sites' ? sitesPage : diagPage,
      )
    }

    // 客户端服务的依赖声明：没有它 apply 会在 slots 就绪前执行，抛错即整站启动失败
    const inject = ['slots', 'locale']

    function apply(ctx) {
      try {
        if (!ctx?.slots?.inject) { report('apply: ctx.slots missing'); return }
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'yunpa',
          order: 36,
          label: () => '云爬',
        }, () => h(Page)))
      } catch (e) {
        report('apply failed: ' + (e && e.message ? e.message : String(e)))
      }
    }

    // 前端任何异常都上报到 host，写进 crash.jsonl
    const reported = new Set()
    function report(message, stack) {
      const key = message + '|' + (stack || '').slice(0, 80)
      if (reported.has(key)) return
      reported.add(key)
      try {
        fetch(API + '/client-error', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: String(message).slice(0, 800), stack: String(stack || '').slice(0, 2000) }),
        }).catch(() => {})
      } catch {}
    }
    try {
      globalThis.addEventListener?.('error', (e) => report('window.error: ' + (e?.message || e), e?.error?.stack))
      globalThis.addEventListener?.('unhandledrejection', (e) => report('unhandledrejection: ' + (e?.reason?.message || e?.reason), e?.reason?.stack))
    } catch {}

    exports.apply = apply
    exports.inject = inject
    exports.__Page = Page  // 供 verify-ui.mjs 渲染测试用
    return module.exports
  },
})
