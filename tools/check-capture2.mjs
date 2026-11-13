// 分步验收：先 collect（不涉及 dialog），再 pick 超时
import { goto } from '../core.js'
import { collectPage, pickElement } from '../capture.js'

const step = async (name, fn, ms = 60000) => {
  const t0 = Date.now()
  try {
    const r = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + ms + 'ms')), ms))])
    console.log('OK  ', name, Date.now() - t0 + 'ms', JSON.stringify(r).slice(0, 200))
  } catch (e) {
    console.log('FAIL', name, Date.now() - t0 + 'ms', String(e.message || e).slice(0, 160))
  }
}

await step('goto data-url', async () => {
  const long = encodeURIComponent('<html><body style="height:5000px"><div id="x">hello-collect</div></body></html>')
  const r = await goto('data:text/html;charset=utf-8,' + long)
  return { ok: !!(r && (r.ok !== false)) }
})

await step('collect', async () => {
  const c = await collectPage({ selector: '#x', maxScroll: 4, waitMs: 200, assert: { contains: 'hello-collect', minLength: 5 } })
  return c
})

await step('pick 超时', async () => {
  const p = await pickElement({ timeoutMs: 4000 })
  return { ok: p.ok, reason: String(p.reason || '').slice(0, 50) }
}, 30000)
