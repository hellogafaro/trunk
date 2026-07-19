# Web parity decisions

Trunk is web-only. The removed Electron implementation remains recoverable from Git history at
`backup/trunk-t3-code-2026-07-19`; it is not part of the active application or dependency graph.

Before restoring any former desktop capability, decide whether it belongs in a browser, should be
implemented by the server, or should stay deleted. Search for `TODO(trunk-web-parity)` to find the
remaining decision points near active web code.

| Former desktop capability                                        | Web-only decision to make                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Embedded Chromium `<webview>` and element picker                 | Prefer the existing server-managed Playwright browser; port only missing interaction or inspection behavior. |
| File and folder pickers                                          | Use browser file APIs where possible; otherwise expose a constrained server-side picker.                     |
| Save and reveal-file actions                                     | Download in the browser, or add a scoped server action; do not expose an unrestricted shell primitive.       |
| Native notifications                                             | Use the Web Notifications API with explicit permission.                                                      |
| Context menus and clipboard                                      | Prefer browser-native APIs and the existing DOM context-menu fallback.                                       |
| External URL handling                                            | Use safe browser navigation with protocol allow-listing.                                                     |
| Secure credential storage                                        | Keep secrets server-side; browser sessions should retain only scoped session credentials.                    |
| Window lifecycle, application menus, updates, and OS integration | Delete permanently unless a concrete web use case appears.                                                   |
| SSH/WSL desktop environment management                           | Delete; remote environments should be represented and managed by the server.                                 |
