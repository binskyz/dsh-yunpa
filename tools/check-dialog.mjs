// 验收 dialog 自动放行：页面在加载时弹 confirm，后续 CDP 命令必须还能用
import { goto, withPage } from '../core.js'

const t0 = Date.now()
const race = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + ms)), ms))])

try {
  const html = encodeURIComponent('<html><body><h1>dialog test</h1><script>window.__r = confirm("确定？")</script></body></html>')
  const nav = await race(goto('data:text/html;charset=utf-8,' + html), 30000)
  console.log('goto      ', Date.now() - t0 + 'ms', JSON.stringify(nav).slice(0, 100))

  const v = await race(withPage(async ({ send }) => {
    const r = await send('Runtime.evaluate', { expression: 'document.querySelector("h1").textContent + "|" + window.__r', returnByValue: true })
    return r.result?.value
  }), 20000)
  console.log('dialog 后 ', Date.now() - t0 + 'ms', JSON.stringify(v))
  console.log(v && String(v).includes('dialog test') ? '✅ dialog 已自动放行' : '❌ 值不对')
} catch (e) {
  console.log('❌', Date.now() - t0 + 'ms', String(e.message || e))
  process.exit(1)
}
