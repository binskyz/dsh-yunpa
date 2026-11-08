# dsh-yunpa

A DeepSeek Harness (DSH) plugin for **logged-in scraping**: an encrypted local credential vault,
a headless controlled browser, and tools that reuse a session across turns.

- Credentials stay on the device: DPAPI-wrapped key + AES-256-GCM, no plaintext on disk, never in chat
- Headless by default (`chrome-headless-shell`), **zero external connections** (11 Google background hosts blocked)
- Settings page inside DSH: Overview / Vault / Password DB / Diagnostics
- 31 `auth_*` / `browser_*` tools over CDP, no third-party dependencies

## Install (unpacked DSH build)

`dsh plugin add` breaks in unpacked builds (pnpm points at a missing runtime). Do it by hand:

```powershell
Copy-Item -Recurse . "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-yunpa"
# then append to cordis.patch.yml (back it up first):
# - insert:
#     - id: yunpa
#       name: 'dsh-yunpa'
#       config: {}
```

Restart DSH; a "云爬 / Yunpa" section appears in Settings.

## Quick check

```bash
node check-all.mjs      # 11 acceptance checks
node upgrade.mjs        # browser version; --apply to update (sha256 pinned)
node verify-release.mjs # publish readiness
```

## Limits

- Windows only (DPAPI / icacls / PowerShell)
- Cookies inside the controlled profile are `v10` (readable by same-user processes); use `auth_capture {wipeProfile:true}` on sensitive sites
- Edge password DB is `v20` (App-Bound): offline decryption is impossible; the plugin drives Edge to autofill and reads the DOM instead
- CDP port binds to 127.0.0.1:9333–9336 and is reachable by any local process

## License

MIT.
