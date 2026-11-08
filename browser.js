// browser.js · 照 dsh-browser-companion 的骨架重铺的一层浏览器动作
// 它全部动作都基于"快照 + 编号 ref"，我这边用 CDP 的 Runtime.evaluate 实现同等语义，
// 不额外依赖 agent-browser / 全局 npm 包。
import { withPage, livePort, launchBrowser, goto, sleep, allCookies, SITES, ROOT } from './core.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const SNAP = String.raw`(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[contenteditable=true]'
  const all = [...document.querySelectorAll(sel)].filter(vis)
  all.forEach((el, i) => el.setAttribute('data-dsh-ref', 'e' + i))
  const label = (el) => (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const kind = (el) => el.type ? (el.tagName.toLowerCase() + ':' + el.type) : el.tagName.toLowerCase()
  const masked = (el) => (el.type === 'password') ? '••••' : (el.value ? String(el.value).slice(0, 40) : '')
  return {
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : '').replace(/\n{2,}/g, '\n').slice(0, MAXTEXT),
    count: all.length,
    elements: all.slice(0, MAXEL).map((el, i) => ({
      ref: 'e' + i, kind: kind(el), label: label(el),
      value: masked(el),
      href: el.href ? String(el.href).slice(0, 120) : null,
    })),
  }
})()`

export async function snapshot({ maxText = 6000, maxElements = 120 } = {}) {
  return withPage(async ({ send }) => {
    const r = await send('Runtime.evaluate', {
      expression: SNAP.replace('MAXTEXT', String(maxText)).replace('MAXEL', String(maxElements)),
      returnByValue: true,
    })
    return r.result?.value ?? { error: 'evaluate failed', detail: r }
  })
}

export async function click(ref) {
  return withPage(async ({ send }) => {
    const js = `(() => {
      const el = document.querySelector('[data-dsh-ref="REF"]')
      if (!el) return { ok: false, reason: 'ref 不存在，先 browser_snapshot' }
      el.scrollIntoView({ block: 'center' })
      el.click()
      return { ok: true, tag: el.tagName, label: (el.innerText || el.value || '').slice(0, 60) }
    })()`.replace('REF', String(ref))
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true })
    return r.result?.value
  })
}

export async function typeInto(ref, text, { allowPassword = false } = {}) {
  return withPage(async ({ send }) => {
    const js = `(() => {
      const el = document.querySelector('[data-dsh-ref="REF"]')
      if (!el) return { ok: false, reason: 'ref 不存在，先 browser_snapshot' }
      if (el.type === 'password' && !ALLOWPW) return { ok: false, reason: 'password-field-refused', hint: '密码字段默认拒填，改用 auth_fill_from_vault' }
      el.scrollIntoView({ block: 'center' })
      el.focus()
      el.value = TEXT
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, len: el.value.length, masked: el.type === 'password' }
    })()`
      .replace('REF', String(ref))
      .replace('TEXT', JSON.stringify(text))
      .replace('ALLOWPW', allowPassword ? 'true' : 'false')
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true })
    return r.result?.value
  })
}

export async function press(key) {
  const codes = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38, Backspace: 8 }
  return withPage(async ({ send }) => {
    const code = codes[key] || 0
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: code, key })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, key })
    return { ok: true, key }
  })
}

export async function scroll(dir = 'down') {
  return withPage(async ({ send }) => {
    const js = dir === 'top' ? 'window.scrollTo(0,0)'
      : dir === 'bottom' ? 'window.scrollTo(0, document.body.scrollHeight)'
      : `window.scrollBy(0, ${dir === 'up' ? -1 : 1} * Math.round(window.innerHeight * 0.9))`
    await send('Runtime.evaluate', { expression: js })
    const r = await send('Runtime.evaluate', { expression: 'Math.round(window.scrollY) + "/" + Math.round(document.body.scrollHeight)', returnByValue: true })
    return { ok: true, dir, position: r.result?.value }
  })
}

export async function getText(selector) {
  return withPage(async ({ send }) => {
    const js = selector
      ? `(document.querySelector(${JSON.stringify(selector)}) || {}).innerText || ''`
      : '(document.body ? document.body.innerText : "")'
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true })
    return { text: String(r.result?.value || '').slice(0, 8000) }
  })
}

export async function meta() {
  return withPage(async ({ send }) => {
    const r = await send('Runtime.evaluate', { expression: 'document.title + "|" + location.href', returnByValue: true })
    const [title, url] = String(r.result?.value || '|').split('|')
    return { title, url }
  })
}

export async function screenshot(out) {
  return withPage(async ({ send }) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    const path = out || ROOT + '/shots/page-' + Date.now() + '.png'
    await mkdir(dirname(path), { recursive: true }).catch(() => {})
    await writeFile(path, Buffer.from(r.data, 'base64'))
    return { file: path, bytes: r.data.length * 0.75 | 0 }
  })
}

const list = async (port) => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()

export async function tabs() {
  const port = await livePort()
  if (!port) return { tabs: [], note: '浏览器没在跑，先 browser_open' }
  const l = await list(port)
  return { tabs: l.filter((t) => t.type === 'page').map((t) => ({ id: t.id, title: t.title, url: t.url })) }
}

export async function newTab(url) {
  const port = (await livePort()) || (await launchBrowser()).port
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()
  return { opened: t.id, url, title: t.title }
}

export async function closeTab(id) {
  const port = await livePort()
  if (!port) return { closed: false, reason: '浏览器没在跑' }
  await fetch(`http://127.0.0.1:${port}/json/close/${id}`)
  return { closed: true, id }
}

export async function waitFor({ selector, urlIncludes, cookieSite, timeoutMs = 20000 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (selector) {
      const has = await withPage(async ({ send }) => {
        const r = await send('Runtime.evaluate', { expression: `!!document.querySelector(${JSON.stringify(selector)})`, returnByValue: true })
        return r.result?.value
      })
      if (has) return { ok: true, hit: 'selector', selector, ms: Date.now() - t0 }
    }
    if (urlIncludes) {
      const m = await meta()
      if ((m.url || '').includes(urlIncludes)) return { ok: true, hit: 'url', url: m.url, ms: Date.now() - t0 }
    }
    if (cookieSite) {
      const port = await livePort()
      if (port) {
        const ck = await allCookies(port, SITES[cookieSite]?.domain || cookieSite)
        const names = ck.map((c) => c.name)
        const need = cookieSite === 'tieba' ? 'BDUSS' : null
        const ok = need ? names.includes(need) : ck.length > 0
        if (ok) return { ok: true, hit: 'cookie', site: cookieSite, cookies: ck.length, ms: Date.now() - t0 }
      }
    }
    await sleep(800)
  }
  return { ok: false, timeoutMs, selector, urlIncludes, cookieSite }
}

// 从当前页面 DOM 直接提楼层（贴吧 / NGA），比正则更稳
export async function postsFromDom(kind) {
  return withPage(async ({ send }) => {
    const sel = kind === 'nga'
      ? { body: '.postcontent, .post_content', author: '.author, .postauthor' }
      : { body: '.d_post_content, .p_content', author: '.p_author_name, .d_name' }
    const js = `(() => {
      const bodySel = ${JSON.stringify(sel.body)}
      const authorSel = ${JSON.stringify(sel.author)}
      const bodies = [...document.querySelectorAll(bodySel)].map(e => (e.innerText || '').trim()).filter(Boolean)
      const authors = [...document.querySelectorAll(authorSel)].map(e => (e.innerText || '').trim()).filter(Boolean)
      return { count: bodies.length, posts: bodies.map((t, i) => ({ author: authors[i] || '', text: t })) }
    })()`
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true })
    return r.result?.value || { count: 0, posts: [] }
  })
}

// 贴吧「吧」列表页：提取帖子标题 + 链接（不是楼层）
export async function threadsFromDom() {
  return withPage(async ({ send }) => {
    const js = `(() => {
      const as = [...document.querySelectorAll('a.j_th_tit, .threadlist_title a, a[href*="/p/"]')]
      const seen = new Set(); const out = []
      for (const a of as) {
        const t = (a.innerText || '').trim()
        const h = a.href || ''
        if (!t || !h.includes('/p/') || seen.has(h)) continue
        seen.add(h); out.push({ title: t, url: h })
      }
      return { count: out.length, threads: out.slice(0, 60) }
    })()`
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true })
    return r.result?.value || { count: 0, threads: [] }
  })
}

// ─────────────────────────────────────────────────────────────
// 实时画面与坐标输入：给「浏览器」页签用（无窗口，画面走 /api/yunpa/live.png）
// 设计取舍：不嵌 iframe（跨站会被 X-Frame-Options 挡，且拿不到受控浏览器的登录态），
// 改成 CDP 截图 + 坐标回放，看到的和点的都是同一个页面。
// ─────────────────────────────────────────────────────────────

const liveMeta = async (send) => {
  const r = await send('Runtime.evaluate', {
    expression: '({ url: location.href, title: document.title })',
    returnByValue: true,
  })
  return r.result?.value || { url: '', title: '' }
}

export async function liveShot({ quality = 72 } = {}) {
  return withPage(async ({ send }) => {
    const m = await send('Page.getLayoutMetrics')
    const vp = m.cssLayoutViewport || {}
    const shot = await send('Page.captureScreenshot', {
      format: 'jpeg', quality, captureBeyondViewport: false, fromSurface: true,
    })
    if (!shot?.data) return { ok: false, error: 'captureScreenshot 没有返回数据' }
    const meta = await liveMeta(send)
    return {
      ok: true, base64: shot.data,
      w: Math.round(vp.clientWidth || 0), h: Math.round(vp.clientHeight || 0),
      url: meta.url, title: meta.title,
    }
  })
}

export async function liveInfo() {
  return withPage(async ({ send }) => {
    const m = await send('Page.getLayoutMetrics')
    const vp = m.cssLayoutViewport || {}
    const meta = await liveMeta(send)
    return { ok: true, ...meta, w: Math.round(vp.clientWidth || 0), h: Math.round(vp.clientHeight || 0) }
  })
}

export async function clickAt(x, y, { button = 'left', clickCount = 1 } = {}) {
  return withPage(async ({ send }) => {
    const px = Math.round(x), py = Math.round(y)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none', buttons: 0 })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button, buttons: 1, clickCount })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button, buttons: 0, clickCount })
    return { ok: true, x: px, y: py }
  })
}

export async function typeText(text) {
  return withPage(async ({ send }) => {
    if (!text) return { ok: true, typed: 0 }
    await send('Input.insertText', { text: String(text) })
    return { ok: true, typed: String(text).length }
  })
}

const KEYMAP = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
}

export async function pressKey(key) {
  const k = KEYMAP[key]
  if (!k) return { ok: false, error: '不支持的键：' + key }
  return withPage(async ({ send }) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...k })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k })
    return { ok: true, key }
  })
}

export async function scrollBy(dy, x = 200, y = 200) {
  return withPage(async ({ send }) => {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(x), y: Math.round(y),
      deltaX: 0, deltaY: Math.round(dy), pointerType: 'mouse',
    })
    return { ok: true, dy }
  })
}
