// capture.js · 元素拾取与滚动采集（纯 CDP，无额外依赖）
// 两个能力借鉴自生态里做得好的插件（sidepanel-web 的元素拾取、dsh-iab 的虚拟滚动回扫），
// 但实现只用自己的 withPage，不引 Playwright/Electron。
import { withPage } from './core.js'

/** 页面里跑的拾取器：高亮跟随鼠标，点击返回选择器，Esc 取消。 */
const PICK_JS = `(() => new Promise((resolve) => {
  const old = document.getElementById('__yunpa_pick')
  if (old) old.remove()
  const box = document.createElement('div')
  box.id = '__yunpa_pick'
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #4c8dff;background:rgba(76,141,255,.15);border-radius:3px'
  const hint = document.createElement('div')
  hint.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:6px 10px;background:#101114;color:#e6e8ee;font:12px system-ui;border-radius:8px'
  hint.textContent = '点击要抓的元素 · Esc 取消'
  document.documentElement.appendChild(box)
  document.documentElement.appendChild(hint)

  const selectorOf = (el) => {
    if (!el || el === document.body) return 'body'
    if (el.id) return '#' + el.id
    const parts = []
    while (el && el.nodeType === 1 && parts.length < 4) {
      let s = el.tagName.toLowerCase()
      if (typeof el.className === 'string' && el.className.trim()) {
        s += '.' + el.className.trim().split(' ').filter(Boolean).slice(0, 2).join('.')
      }
      const p = el.parentElement
      if (p) {
        const same = Array.prototype.filter.call(p.children, (x) => x.tagName === el.tagName)
        if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')'
      }
      parts.unshift(s)
      el = el.parentElement
    }
    return parts.join(' > ')
  }

  const cleanup = () => {
    box.remove(); hint.remove()
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKey, true)
  }
  const onMove = (e) => {
    const r = e.target.getBoundingClientRect()
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px'
  }
  const onClick = (e) => {
    e.preventDefault(); e.stopPropagation()
    const el = e.target
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const out = {
      ok: true,
      selector: selectorOf(el),
      tag: el.tagName,
      text: (el.innerText || '').trim().slice(0, 300),
      html: el.outerHTML.slice(0, 1000),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      style: { display: cs.display, color: cs.color, fontSize: cs.fontSize },
      count: document.querySelectorAll(selectorOf(el)).length,
    }
    cleanup(); resolve(out)
  }
  const onKey = (e) => { if (e.key === 'Escape') { cleanup(); resolve({ ok: false, reason: 'cancelled' }) } }
  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
}))()`

/** 滚动采集：反复滚到底、收文本、直到两次滚动没有新内容。 */
const collectJs = (selector, maxScroll, waitMs) => `(async () => {
  const sel = ${JSON.stringify(selector || '')}
  const grab = () => {
    if (!sel) return (document.body ? document.body.innerText : '') || ''
    const els = Array.prototype.slice.call(document.querySelectorAll(sel))
    return els.map((e) => (e.innerText || '').trim()).filter(Boolean).join('\\n')
  }
  let best = ''
  let scrolls = 0
  let stable = 0
  for (let i = 0; i < ${maxScroll}; i++) {
    const t = grab()
    if (t.length > best.length) best = t
    const before = Math.round(window.scrollY + window.innerHeight) + '/' + document.body.scrollHeight
    window.scrollTo(0, document.body.scrollHeight)
    scrolls++
    await new Promise((r) => setTimeout(r, ${waitMs}))
    const after = Math.round(window.scrollY + window.innerHeight) + '/' + document.body.scrollHeight
    if (after === before) { stable++; if (stable >= 2) break } else stable = 0
  }
  return { ok: true, url: location.href, title: document.title, text: best, length: best.length, scrolls }
})()`

export async function pickElement({ timeoutMs = 120000 } = {}) {
  const wait = Math.max(5000, Number(timeoutMs) || 120000)
  return withPage(async ({ send }) => {
    // CDP 的 Runtime.evaluate timeout 对 awaitPromise 的 Promise 不生效，
    // 自己用 Promise.race 兜底，否则用户不点就永远挂着。
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: PICK_JS, awaitPromise: true, returnByValue: true }),
      new Promise((res) => setTimeout(() => res({ __timeout: true }), wait)),
    ])
    if (r && r.__timeout) return { ok: false, reason: 'timeout（用户没点也没按 Esc）' }
    const v = r && r.result && r.result.value
    if (v) return v
    if (r && r.exceptionDetails) {
      return { ok: false, reason: '页面拒绝了拾取脚本：' + String(r.exceptionDetails.text || '').slice(0, 160) }
    }
    return { ok: false, reason: 'no result: ' + JSON.stringify(r).slice(0, 160) }
  })
}

export async function collectPage({ selector = '', maxScroll = 30, waitMs = 400, assert } = {}) {
  const max = Math.max(1, Math.min(200, Number(maxScroll) || 30))
  const wait = Math.max(120, Math.min(3000, Number(waitMs) || 400))
  const out = await withPage(async ({ send }) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: collectJs(selector, max, wait), awaitPromise: true, returnByValue: true }),
      new Promise((res) => setTimeout(() => res({ __timeout: true }), 90000)),
    ])
    if (r && r.__timeout) return { ok: false, reason: 'timeout 90s' }
    if (r && r.exceptionDetails) {
      return { ok: false, reason: 'evaluate 异常：' + JSON.stringify(r.exceptionDetails).slice(0, 200) }
    }
    const v = r && r.result && r.result.value
    return v && typeof v === 'object' ? v : { ok: false, reason: 'evaluate 无返回：' + JSON.stringify(r).slice(0, 200) }
  })
  if (!out || out.ok !== true) return out

  // 断言在 host 侧做：抓完当场判定，比事后人工看结论稳
  const checks = []
  if (assert && typeof assert === 'object') {
    if (Number.isFinite(assert.minLength)) {
      checks.push({ name: 'minLength', ok: out.length >= assert.minLength, detail: out.length + ' >= ' + assert.minLength })
    }
    if (typeof assert.contains === 'string' && assert.contains) {
      checks.push({ name: 'contains', ok: out.text.includes(assert.contains), detail: assert.contains.slice(0, 60) })
    }
  }
  return {
    ok: true, url: out.url, title: out.title, length: out.length, scrolls: out.scrolls,
    text: out.text, checks: checks.length ? checks : null,
    allChecksPassed: checks.length ? checks.every((c) => c.ok) : null,
  }
}
