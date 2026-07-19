# Trunk web parity

Trunk is a web-only fork of [Synara](https://github.com/Emanuele-web04/synara). Synara's
Electron implementation remains available in upstream history; this file tracks native
capabilities worth migrating behind server APIs when there is a concrete web use case.

## Candidate migrations

- **AppSnap and screen capture** — capture a screen or application window on the host and
  deliver the image and source metadata to the active composer.
- **Native notifications** — send task-completion and activity notifications through a
  server-side host integration, with browser notifications as the web fallback.
- **File and folder selection** — let the server provide an explicit, permission-aware host
  path picker where browser file inputs are insufficient.
- **Save and reveal-file actions** — save exports to a chosen host path and reveal generated
  files in the host file manager.
- **Context menus and clipboard operations** — preserve native menu commands and image/text
  clipboard behavior where browser APIs do not offer equivalent permissions or formats.
- **Voice transcription** — move host-assisted audio capture and transcription to an explicit
  server endpoint while retaining browser recording where supported.
- **Browser lifecycle operations** — expose the useful parts of native browser-panel window,
  focus, and navigation management through server-owned browser sessions.
- **External URL handling** — validate and open external links through a server host action
  when the browser cannot or should not open them directly.

## Migration policy

Add new Electron-only capabilities introduced upstream to this list during merges. Keep
existing compatibility branches when they still compile, and mark relevant web call sites
with `TODO(trunk-web-parity)` until a real server-backed migration is designed. No generic
capability framework or validation layer is planned yet.
