// 用 Edge 自己的密码管理器填表：聚焦账号框 → ArrowDown → Enter（Chrome/Edge 的自动填充键盘选择）
import { withPage, sleep } from './core.js'

export async function focusField(selectorHint) {
  return withPage(async ({ send }) => {
    const js = `(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const inputs = [...document.querySelectorAll('input')].filter(vis)
  const pwd = inputs.find(i => (i.type||'').toLowerCase() === 'password')
  const txt = inputs.find(i => ['text','email','tel',''].includes((i.type||'').toLowerCase()))
  const target = txt || pwd
  if (!target) return { ok: false, inputs: inputs.length }
  target.scrollIntoView({ block: 'center' })
  target.focus(); target.click()
  return { ok: true, name: target.name || target.id || null, key: '${selectorHint || ''}' }
})()`
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true })
    return r.result?.value
  })
}

export async function keyPress(key) {
  return withPage(async ({ send }) => {
    const codes = { ArrowDown: 40, Enter: 13, Tab: 9 }
    const code = codes[key] || 0
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: code, key })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, key })
    return { sent: key }
  })
}

export async function fieldValues() {
  return withPage(async ({ send }) => {
    const r = await send('Runtime.evaluate', {
      expression: `[...document.querySelectorAll('input')].map(i => ({ name: i.name || i.id, type: i.type, filled: !!i.value, len: (i.value||'').length }))`,
      returnByValue: true,
    })
    return r.result?.value
  })
}

export async function clickField() {
  return withPage(async ({ send }) => {
    const js = `(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const inputs = [...document.querySelectorAll('input')].filter(vis)
  const txt = inputs.find(i => ['text','email','tel',''].includes((i.type||'').toLowerCase()))
  if (!txt) return null
  txt.scrollIntoView({ block: 'center' })
  const r = txt.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})()`
    const r = await send('Runtime.evaluate', { expression: js, returnByValue: true })
    const pt = r.result?.value
    if (!pt) return null
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
    return pt
  })
}

export async function tryPasswordManagerFill() {
  await clickField()
  await sleep(1200)
  const f = await focusField()
  if (!f?.ok) return { ok: false, reason: '没找到输入框', detail: f }
  await sleep(600)
  await keyPress('ArrowDown')
  await sleep(400)
  await keyPress('Enter')
  await sleep(800)
  const vals = await fieldValues()
  const pwFilled = (vals || []).some((v) => v.type === 'password' && v.filled)
  return { ok: pwFilled, focused: f.name, values: vals }
}
