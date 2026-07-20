# Trusted preview browser

Trunk uses stable Google Chrome in headed mode for preview browsing when Chrome is installed and a
graphical display is available. It stores browser state in a dedicated profile under
`$T3CODE_HOME/browser` (or `~/.t3/browser` by default), so cookies and login sessions survive server
restarts without exposing the user's everyday Chrome profile.

If stable Chrome or a graphical display is unavailable, Trunk falls back to its managed headless
Chromium. Set `T3CODE_BROWSER_EXECUTABLE_PATH` to override Chrome discovery.

Authentication, MFA, and anti-bot challenge pages are reserved for manual interaction. Trunk pauses
agent actions while verification is present and avoids automatic challenge clicks. After completing
verification, the next agent action rechecks the page and continues when the challenge is gone.

For fewer challenge loops:

- Keep Chrome current.
- Avoid VPNs and proxies when possible.
- Do not add script blockers, canvas blockers, or fingerprint-changing extensions to this profile.
- Do not copy clearance cookies between browser profiles.

This mode reduces false positives but cannot guarantee that a site will permit automation.
