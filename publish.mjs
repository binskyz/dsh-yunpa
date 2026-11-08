// 一条命令把仓库发到 GitHub。每一步都先验证再动手，失败就停在那一步，不猜着往下走。
//   node publish.mjs --token ghp_xxx            公开仓库
//   node publish.mjs --token ghp_xxx --private  私有仓库
//   node publish.mjs --check                    只体检（不联网、不改文件）
//   node publish.mjs --dry-run --token xxx      替换占位 + 复验，不 commit 不推送
//
// token 权限只要：Contents: Read and write、Administration: Read and write（建仓库才要）。
// token 不落盘：只在内存里用于 API 与一次 push，推完 remote 会被改回不含 token 的地址。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (k) => argv.includes('--' + k)
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const CHECK_ONLY = flag('check')
const DRY = flag('dry-run') && !CHECK_ONLY
const PRIVATE = flag('private')
const REPO = opt('repo', 'dsh-yunpa')
const TOKEN = opt('token') || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const TS = new Date().toISOString().replace(/[:.]/g, '-')

const step = (n, text) => console.log(`\n[${n}] ${text}`)
const ok = (t) => console.log('    ✅ ' + t)
const warn = (t) => console.log('    ⚠️  ' + t)
const die = (t) => { console.error('    ❌ ' + t); console.error('\n停在这一步，没有继续往下做。'); process.exit(1) }

const sh = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      ...opts,
    }).trim()
  } catch (e) {
    const err = (e.stderr || e.stdout || e.message || '').toString().trim()
    throw new Error(`${cmd} ${args.join(' ')} 失败：${err}`)
  }
}
// Windows 的 Git Credential Manager 会缓存一份旧凭据，把 URL 里的 token 顶掉，
// 表现是「API 明明能用，git 却报 invalid credentials」。清掉助手即可。
const git = (args, opts) => sh('git', ['-c', 'credential.helper=', ...args], opts)
const pkg = JSON.parse(readFileSync(ROOT + '/package.json', 'utf8'))
const VERSION = pkg.version

// 会把占位换成真实用户名的文件
const PLACEHOLDER_FILES = ['package.json', '.github/ISSUE_TEMPLATE/config.yml', 'docs/发布清单.md']

async function api(path, init = {}) {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-yunpa-publish',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  // 409/422 都是「仓库已存在」，不算失败；其余 4xx/5xx 直接抛出
  if (!res.ok && res.status !== 409 && res.status !== 422) {
    const msg = body?.message || String(body).slice(0, 200)
    throw new Error(`GitHub API ${path} → ${res.status} ${msg}`)
  }
  return { status: res.status, body }
}

// ── 0. 前置体检 ─────────────────────────────────────────────
step(0, '前置体检')
try { ok('git ' + git(['--version']).replace('git version ', '')) } catch (e) { die(e.message) }
if (!existsSync(ROOT + '/.git')) die('没有 .git：先跑 git init -b main')
ok('.git 存在')
const placeholders = PLACEHOLDER_FILES.filter((f) => existsSync(ROOT + '/' + f) && readFileSync(ROOT + '/' + f, 'utf8').includes('OWNER'))
if (placeholders.length) ok('待替换占位的文件：' + placeholders.length + ' 个（' + placeholders.join(', ') + '）')
else warn('没找到 OWNER 占位（可能已经替换过）')

if (!TOKEN) {
  if (CHECK_ONLY) {
    warn('没有 token：--token / GITHUB_TOKEN / GH_TOKEN 都为空，无法推送')
    console.log('\n体检到此为止（没联网）。给 token 后重跑同一条命令即可。')
    process.exit(0)
  }
  die('缺 token：加 --token <PAT>，或先 export GITHUB_TOKEN=...')
}

// ── 1. 校验 token 并取 login ────────────────────────────────
step(1, '校验 token')
let login
try {
  const r = await api('/user')
  login = r.body?.login
  if (!login) die('token 有效但拿不到 login')
  ok(`已登录为 ${login}（公开仓库数 ${r.body.public_repos}）`)
} catch (e) { die(e.message) }

const FULL = `${login}/${REPO}`

// ── 2. 替换 OWNER 占位 ─────────────────────────────────────
step(2, '替换 OWNER 占位')
const written = []
for (const f of PLACEHOLDER_FILES) {
  const p = ROOT + '/' + f
  if (!existsSync(p)) continue
  const t = readFileSync(p, 'utf8')
  if (!t.includes('OWNER')) continue
  copyFileSync(p, `${p}.bak-publish-${TS}`)
  writeFileSync(p, t.split('OWNER').join(login), 'utf8')
  written.push(f)
}
written.length ? ok(`${written.length} 个文件已替换：${written.join(', ')}`) : ok('无需替换')

// 文档里出现的地址一致性
const leftover = PLACEHOLDER_FILES
  .filter((f) => existsSync(ROOT + '/' + f))
  .filter((f) => readFileSync(ROOT + '/' + f, 'utf8').includes('github.com/OWNER'))
if (leftover.length) die('还有 github.com/OWNER 残留：' + leftover.join(', '))

// ── 3. 复验（改完必须重跑）──────────────────────────────────
step(3, '复验（替换会动 package.json，必须重跑）')
for (const script of ['verify-release.mjs', '.github/scripts/check-templates.mjs', '.github/scripts/check-doc-links.mjs']) {
  try { sh('node', [script]); ok(script) } catch (e) { die(script + ' 不通过：\n' + e.message) }
}

if (DRY) {
  console.log('\n--dry-run：到此为止，未 commit、未推送。改动已落盘，备份以 .bak-publish-* 结尾。')
  process.exit(0)
}

// ── 4. 提交 ────────────────────────────────────────────────
step(4, '提交')
git(['config', 'user.name', login])
git(['config', 'user.email', `${login}@users.noreply.github.com`])
ok(`提交身份：${login} <${login}@users.noreply.github.com>`)
git(['add', '-A'])
const staged = git(['diff', '--cached', '--name-only'])
if (!staged) {
  ok('暂存区为空，跳过提交')
} else {
  const n = staged.split('\n').length
  try {
    git(['commit', '-m', `feat: dsh-yunpa ${VERSION} — 登录态抓取插件首个公开版本`])
    ok(`${n} 个文件已提交`)
  } catch (e) { die(e.message) }
}
ok('分支：' + git(['rev-parse', '--abbrev-ref', 'HEAD']) + ' · 提交 ' + git(['rev-parse', '--short', 'HEAD']))

// ── 5. 建仓库 ──────────────────────────────────────────────
step(5, `建仓库 ${FULL}（${PRIVATE ? 'private' : 'public'}）`)
try {
  const r = await api('/user/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: REPO,
      private: PRIVATE,
      description: pkg.description,
      homepage: `https://github.com/${FULL}#readme`,
      has_issues: true,
      has_wiki: false,
      auto_init: false,
    }),
  })
  if (r.status === 201) ok('已创建：' + (r.body?.html_url || FULL))
  else warn(`仓库已存在（HTTP ${r.status}），直接推送`)
} catch (e) {
  if (/already exists/i.test(e.message)) warn('仓库已存在，直接推送')
  else die(e.message)
}

// ── 6. 推送（token 只在这一次使用）──────────────────────────
step(6, '推送')
const cleanRemote = `https://github.com/${FULL}.git`
try { git(['remote', 'remove', 'origin']) } catch { /* 没有就跳过 */ }
git(['remote', 'add', 'origin', `https://x-access-token:${TOKEN}@github.com/${FULL}.git`])
try {
  git(['push', '-u', 'origin', 'HEAD:main'])
  ok('main 已推送')
} catch (e) {
  git(['remote', 'set-url', 'origin', cleanRemote])
  // 命中率最高的两种拒绝，直接给出该改哪个 scope
  if (/workflow/i.test(e.message)) {
    die(e.message + '\n\n这个 token 缺 workflow scope：仓库里有 .github/workflows/*.yml。\n去 https://github.com/settings/tokens 点开该 token → 勾上 workflow → Update token（值不变），然后重跑本命令。')
  }
  if (/invalid credentials|Authentication failed/i.test(e.message)) {
    die(e.message + '\n\n凭据被 Windows 凭据管理器拦了：确认 URL 里的 token 正确，或改用 git -c credential.helper= 显式绕过。')
  }
  die(e.message + '\n（已把 remote 改回不含 token 的地址）')
}
git(['remote', 'set-url', 'origin', cleanRemote])
ok('remote 已改回不含 token 的地址')

// ── 7. 打 tag ──────────────────────────────────────────────
step(7, `打 tag v${VERSION}`)
try {
  git(['rev-parse', `v${VERSION}`])
  warn(`tag v${VERSION} 已存在，跳过`)
} catch {
  git(['tag', '-a', `v${VERSION}`, '-m', `dsh-yunpa ${VERSION}`])
  git(['push', 'origin', `v${VERSION}`])
  ok(`v${VERSION} 已推送（Release 工作流会自动跑）`)
}

// ── 8. 验证 ────────────────────────────────────────────────
step(8, '验证')
try {
  const r = await api(`/repos/${FULL}`)
  ok('仓库可访问：' + r.body.html_url + `（${r.body.private ? 'private' : 'public'}）`)
  const runs = await api(`/repos/${FULL}/actions/runs?per_page=3`)
  const list = runs.body?.workflow_runs || []
  if (!list.length) warn('还没有工作流记录（推送后几秒才会出现，稍后刷新页面看）')
  else for (const w of list.slice(0, 3)) console.log(`    · ${w.name} #${w.run_number} ${w.status}/${w.conclusion ?? '-'} ${w.html_url}`)
} catch (e) { warn('验证请求失败：' + e.message) }

console.log(`
────────────────────────────────────────
发出去了：https://github.com/${FULL}
版本：v${VERSION}

接下来盯三处（约 1–2 分钟）：
  1. Actions → CI 两个 job 都要绿
  2. Releases → v${VERSION} 下应有 dsh-yunpa-${VERSION}.tgz
  3. Issues → New issue 能看到「Bug 报告 / 功能请求」表单

token 用完请立刻 Revoke：
  https://github.com/settings/tokens
────────────────────────────────────────`)
