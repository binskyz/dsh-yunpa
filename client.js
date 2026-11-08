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
/* 侧边栏主面板：占满中央列，宽一点，自带滚动 */
.nva-panel{height:100%;overflow:auto;padding:18px 22px 28px;box-sizing:border-box}
.nva-panel .nva{max-width:960px;margin:0 auto}
/* 「浏览器」页签：画面 + 坐标点击 + 键盘回放 */
.nva .live-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nva .live-url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px;flex:1;min-width:120px}
.nva .live-shot{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);line-height:0}
.nva .live-shot img{width:100%;height:auto;display:block;cursor:crosshair}
.nva .live-input{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.nva .live-input input{flex:1;min-width:160px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary)}
/* 右侧浮层抽屉（shell.overlay）：常驻可见、可收起 */
.yunpa-dock-handle{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:60;pointer-events:auto;writing-mode:vertical-rl;letter-spacing:2px;padding:14px 5px;border-radius:10px 0 0 10px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-right:0;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;box-shadow:-2px 0 8px rgba(0,0,0,.12)}
.yunpa-dock{position:fixed;right:10px;top:64px;bottom:12px;width:min(420px,42vw);z-index:61;pointer-events:auto;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:14px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);box-shadow:0 8px 28px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary)}
.yunpa-dock-head{display:flex;align-items:center;gap:6px;cursor:grab;user-select:none;touch-action:none}
.yunpa-dock-head:active{cursor:grabbing}
.yunpa-dock-handle{touch-action:none;user-select:none}
.yunpa-dock-title{font-size:13px;font-weight:600;white-space:nowrap}
.yunpa-dock button{font-size:12px;padding:4px 8px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer;white-space:nowrap}
.yunpa-dock button.pri{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}
.yunpa-dock .mono{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yunpa-dock-shot{flex:1;min-height:0;overflow:auto;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);line-height:0;background:#000}
.yunpa-dock-shot img{width:100%;height:auto;display:block;cursor:crosshair}
.yunpa-dock-empty{flex:1;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary);padding:0 10px}
.yunpa-dock-input{display:flex;gap:6px}
.yunpa-dock-input input{flex:1;min-width:0;font:inherit;font-size:12px;padding:6px 8px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit}
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
      { id: 'live', label: '浏览器' },
      { id: 'vault', label: '凭据库' },
      { id: 'edge', label: '密码库' },
      { id: 'sites', label: '站点' },
      { id: 'diag', label: '诊断' },
    ]

    // 侧边栏图标：sidebar.panellist 只给 size 和 active，图案由我们画
    function YunpaIcon({ size = 20, active } = {}) {
      const stroke = 'currentColor'
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true',
        style: { display: 'block', opacity: active ? 1 : 0.7, transition: 'opacity .15s' },
      },
        h('path', {
          d: 'M7.6 17.4a4.1 4.1 0 0 1 .8-8.1 5.5 5.5 0 0 1 10.3 1.5 3.6 3.6 0 0 1-.4 6.6z',
          fill: 'none', stroke, strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M12 11.6v5.2m0 0-2.4-2.4M12 16.8l2.4-2.4',
          fill: 'none', stroke, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      )
    }

    // 中央面板外壳：把设置页那套页签直接搬进主列
    function Panel() {
      return h('div', { className: 'nva-panel' }, h(Page))
    }

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

      const livePage = h(LivePage)

      return h('div', { className: 'nva' },
        h('h2', null, '云爬'),
        h('p', { className: 'intro' }, '受控浏览器、加密凭据库与迁移来的浏览器密码。凭据只存本机（DPAPI + AES-256-GCM），不进对话。'),
        h('div', { className: 'tabs' }, TABS.map((t) => h('button', {
          key: t.id, className: 'tab', 'data-active': tab === t.id, onClick: () => setTab(t.id),
        }, t.label))),
        note ? h('div', { className: 'mono' }, note) : null,
        tab === 'live' ? livePage : tab === 'overview' ? overview : tab === 'vault' ? vaultPage : tab === 'edge' ? edgePage : tab === 'sites' ? sitesPage : diagPage,
      )
    }

    // 「浏览器」页签：受控浏览器画面直接铺在面板里，点画面=点页面，输入框=往页面打字
    function LivePage() {
      const [tick, setTick] = useState(0)
      const [live, setLive] = useState(true)
      const [info, setInfo] = useState({ w: 800, h: 600, url: '', title: '' })
      const [note, setNote] = useState('')
      const [text, setText] = useState('')
      const imgRef = React.useRef(null)

      useEffect(() => {
        let stop = false
        const pull = async () => {
          try {
            const j = await get('/live/info')
            if (!stop && j && j.ok) setInfo(j)
          } catch { /* 浏览器没起时静默 */ }
        }
        pull()
        const t = setInterval(() => {
          if (stop || !live) return
          pull()
          setTick((n) => n + 1)
        }, 1200)
        return () => { stop = true; clearInterval(t) }
      }, [live])

      const act = async (path, body) => {
        try {
          const r = await post(path, body)
          if (r && r.error) setNote(String(r.error).slice(0, 140))
          return r
        } catch (e) { setNote(String(e && e.message ? e.message : e).slice(0, 140)); return null }
      }

      const clickAt = async (e) => {
        const el = imgRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) return
        const x = Math.round(((e.clientX - r.left) / r.width) * (info.w || r.width))
        const y = Math.round(((e.clientY - r.top) / r.height) * (info.h || r.height))
        await act('/live/click', { x, y })
        setTick((n) => n + 1)
      }

      const send = async () => {
        if (!text) return
        await act('/live/type', { text })
        setText('')
        setTick((n) => n + 1)
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'live-bar' },
          h('button', { className: 'act', onClick: async () => { const r = await act('/action', { name: 'open' }); setNote(r && r.port ? '浏览器已启动 · ' + r.port : '已启动') } }, '启动'),
          h('button', { className: 'act', onClick: async () => { await act('/action', { name: 'close' }); setNote('浏览器已关闭') } }, '关闭'),
          h('button', { className: 'act', onClick: () => setLive((v) => !v) }, live ? '暂停' : '继续'),
          h('span', { className: 'mono live-url', title: info.url || '' }, info.title || info.url || '未启动'),
        ),
        h('div', { className: 'live-shot' },
          h('img', {
            ref: imgRef, alt: '受控浏览器画面', draggable: false,
            src: live ? '/api/yunpa/live.png?q=62&t=' + tick : undefined,
            onClick: clickAt,
            style: live ? undefined : { opacity: 0.4 },
          }),
        ),
        h('div', { className: 'live-input' },
          h('input', {
            value: text,
            placeholder: '先在画面上点一下输入框，再在这里打字',
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') send() },
          }),
          h('button', { className: 'act', onClick: send }, '发送'),
          h('button', { className: 'act', onClick: () => act('/live/key', { key: 'Enter' }) }, 'Enter'),
          h('button', { className: 'act', onClick: () => act('/live/key', { key: 'Tab' }) }, 'Tab'),
          h('button', { className: 'act', onClick: () => act('/live/key', { key: 'Escape' }) }, 'Esc'),
        ),
        note ? h('div', { className: 'mono' }, note) : null,
        h('div', { className: 'mono' }, '画面 ' + info.w + '×' + info.h + ' · 每 1.2 秒刷新一次，点画面即点击页面'),
      )
    }

    // ── 右侧浮层抽屉：网页常驻侧边、可收起、agent 操作时实时可见 ──
    const DOCK_KEY = 'yunpa.dock.open'
    const POS_KEY = 'yunpa.dock.pos'
    const HANDLE_KEY = 'yunpa.dock.handle'
    function YunpaDock() {
      const [open, setOpen] = useState(() => {
        try { return localStorage.getItem(DOCK_KEY) !== '0' } catch { return true }
      })
      const [live, setLive] = useState(true)
      const [tick, setTick] = useState(0)
      const [running, setRunning] = useState(null)
      const [info, setInfo] = useState({ w: 800, h: 600, url: '', title: '' })
      const [note, setNote] = useState('')
      const [text, setText] = useState('')
      const imgRef = React.useRef(null)
      const dockRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const handleDrag = React.useRef(null)
      // 位置：null = 默认贴右侧；有值则是拖动后的 {x,y,w,h}
      const [pos, setPos] = useState(() => {
        try {
          const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
          return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null
        } catch { return null }
      })
      const [handleY, setHandleY] = useState(() => {
        try { const v = Number(localStorage.getItem(HANDLE_KEY)); return Number.isFinite(v) ? v : 0 } catch { return 0 }
      })

      useEffect(() => { try { localStorage.setItem(DOCK_KEY, open ? '1' : '0') } catch {} }, [open])

      // 窗口缩小后把面板拉回可见范围，避免拖到屏幕外找不回来
      useEffect(() => {
        const onResize = () => {
          setPos((p) => {
            if (!p) return p
            const x = Math.min(p.x, Math.max(0, window.innerWidth - 90))
            const y = Math.min(p.y, Math.max(0, window.innerHeight - 44))
            return x === p.x && y === p.y ? p : { ...p, x, y }
          })
          setHandleY((y) => (y ? Math.min(y, window.innerHeight - 60) : y))
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      // 浏览器是否在跑：3 秒探一次，不打扰页面
      useEffect(() => {
        if (!open) return
        let stop = false
        const pull = async () => {
          try {
            const s = await get('/status')
            if (!stop) setRunning(!!s?.browser?.running)
          } catch { /* host 没起时静默 */ }
        }
        pull()
        const t = setInterval(pull, 3000)
        return () => { stop = true; clearInterval(t) }
      }, [open])

      // 画面帧：400ms 一帧，agent 的每一步都能看到
      useEffect(() => {
        if (!open || !live || !running) return
        let stop = false
        const meta = async () => {
          try {
            const i = await get('/live/info')
            if (!stop && i && i.ok) setInfo(i)
          } catch {}
        }
        meta()
        const t = setInterval(() => { if (!stop) setTick((n) => n + 1) }, 400)
        return () => { stop = true; clearInterval(t) }
      }, [open, live, running])

      const act = async (path, body) => {
        try {
          const r = await post(path, body)
          if (r && r.error) setNote(String(r.error).slice(0, 120))
          return r
        } catch (e) { setNote(String(e && e.message ? e.message : e).slice(0, 120)); return null }
      }

      const clickShot = async (e) => {
        const el = imgRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) return
        const x = Math.round(((e.clientX - r.left) / r.width) * (info.w || r.width))
        const y = Math.round(((e.clientY - r.top) / r.height) * (info.h || r.height))
        await act('/live/click', { x, y })
        setTick((n) => n + 1)
      }

      // ── 拖动：头部按住移动面板；边缘竖标签按住上下移动；双击复位 ──
      const moved = React.useRef(false)
      const startAt = React.useRef({ x: 0, y: 0 })

      const beginDrag = (e) => {
        const el = dockRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height }
        startAt.current = { x: e.clientX, y: e.clientY }
        moved.current = false
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
        e.preventDefault()
      }
      const moveDrag = (e) => {
        const d = dragRef.current
        if (!d) return
        if (Math.abs(e.clientX - startAt.current.x) + Math.abs(e.clientY - startAt.current.y) > 4) moved.current = true
        const maxX = Math.max(0, window.innerWidth - 90)
        const maxY = Math.max(0, window.innerHeight - 44)
        const x = Math.min(Math.max(-d.w + 90, e.clientX - d.dx), maxX)
        const y = Math.min(Math.max(0, e.clientY - d.dy), maxY)
        setPos({ x, y, w: d.w, h: d.h })
      }
      const endDrag = (e) => {
        if (!dragRef.current) return
        dragRef.current = null
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
        setPos((p) => {
          if (p) { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch {} }
          return p
        })
      }
      const resetPos = () => {
        dragRef.current = null
        setPos(null)
        setHandleY(0)
        try { localStorage.removeItem(POS_KEY); localStorage.removeItem(HANDLE_KEY) } catch {}
      }
      const beginHandleDrag = (e) => {
        handleDrag.current = { offset: e.clientY - (handleY || window.innerHeight / 2) }
        startAt.current = { x: e.clientX, y: e.clientY }
        moved.current = false
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
        e.preventDefault()
      }
      const moveHandleDrag = (e) => {
        if (!handleDrag.current) return
        if (Math.abs(e.clientY - startAt.current.y) > 4) moved.current = true
        const y = Math.min(Math.max(24, e.clientY - handleDrag.current.offset), window.innerHeight - 60)
        setHandleY(y)
      }
      const endHandleDrag = (e) => {
        if (!handleDrag.current) return
        handleDrag.current = null
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
        setHandleY((y) => { try { localStorage.setItem(HANDLE_KEY, String(y || 0)) } catch {}; return y })
      }
      const stopDrag = (e) => { e.stopPropagation() }

      if (!open) {
        return h('div', {
          className: 'yunpa-dock-handle',
          title: '展开云爬实时画面（按住上下拖；双击复位）',
          onPointerDown: beginHandleDrag,
          onPointerMove: moveHandleDrag,
          onPointerUp: endHandleDrag,
          onPointerCancel: endHandleDrag,
          onDoubleClick: resetPos,
          onClick: () => {
            if (moved.current) { moved.current = false; return }
            setOpen(true)
          },
          style: handleY ? { top: handleY + 'px', transform: 'none' } : undefined,
        }, '云爬')
      }

      return h('div', {
        className: 'yunpa-dock',
        ref: dockRef,
        style: pos
          ? { left: pos.x + 'px', top: pos.y + 'px', width: (pos.w || 420) + 'px', height: (pos.h || 520) + 'px', right: 'auto', bottom: 'auto' }
          : undefined,
      },
        h('div', {
          className: 'yunpa-dock-head',
          title: '拖住这里移动面板 · 双击复位到右侧',
          onPointerDown: beginDrag,
          onPointerMove: moveDrag,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onDoubleClick: resetPos,
        },
          h('span', { className: 'yunpa-dock-title' }, '云爬 · 浏览器'),
          h('span', { className: 'mono', style: { flex: 1, minWidth: 0 } },
            running === null ? '连接中…' : running ? (info.title || info.url || '已启动') : '未启动'),
          h('button', { onPointerDown: stopDrag, onClick: () => setLive((v) => !v), title: live ? '暂停刷新' : '继续刷新' }, live ? '暂停' : '继续'),
          h('button', { onPointerDown: stopDrag, onClick: () => setOpen(false), title: '收起' }, '收起'),
        ),
        running
          ? h('div', { className: 'yunpa-dock-shot' },
            h('img', {
              ref: imgRef, alt: '受控浏览器画面', draggable: false,
              src: live ? '/api/yunpa/live.png?q=60&t=' + tick : undefined,
              onClick: clickShot,
              onError: () => setRunning(false),
              style: live ? undefined : { opacity: 0.45 },
            }))
          : h('div', { className: 'yunpa-dock-empty' },
            h('button', {
              className: 'pri',
              onClick: async () => {
                const r = await act('/action', { name: 'open' })
                setRunning(!!(r && r.port))
                setNote(r && r.port ? '已启动 · 端口 ' + r.port : '已启动')
              },
            }, '启动受控浏览器'),
            h('div', null, '启动后画面就在这块里，agent 的每一步操作都能看到'),
            note ? h('div', { className: 'mono' }, note) : null),
        h('div', { className: 'yunpa-dock-input' },
          h('input', {
            value: text, placeholder: '点画面定位输入框，再在这里打字',
            onChange: (e) => setText(e.target.value),
            onKeyDown: async (e) => {
              if (e.key !== 'Enter' || !text) return
              await act('/live/type', { text }); setText(''); setTick((n) => n + 1)
            },
          }),
          h('button', {
            onClick: async () => { if (text) { await act('/live/type', { text }); setText(''); setTick((n) => n + 1) } },
          }, '发送'),
          h('button', { onClick: () => act('/live/key', { key: 'Enter' }) }, '⏎'),
        ),
        running ? null : null,
        note && running ? h('div', { className: 'mono' }, note) : null,
      )
    }

    // 客户端服务的依赖声明：没有它 apply 会在 slots 就绪前执行，抛错即整站启动失败
    const inject = ['slots', 'locale']

    function apply(ctx) {
      try {
        if (!ctx?.slots?.inject) { report('apply: ctx.slots missing'); return }
        // ① 设置页（保留：从「设置 → 云爬」也能进）
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'yunpa',
          order: 36,
          label: () => '云爬',
        }, () => h(Page)))
        // ② 左侧栏图标 + 中央面板：list id 与 main 的 key 用同一个值，点图标就切到这块面板
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'yunpa',
          order: 20,
          label: () => '云爬',
        }, (props) => h(YunpaIcon, props || {})))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'yunpa',
        }, () => h(Panel)))
        // ③ 右侧浮层抽屉：常驻可见、可收起，agent 操作时每一步都能看到
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'yunpa-live',
          order: 60,
          label: () => '云爬实时画面',
        }, () => h(YunpaDock)))
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
