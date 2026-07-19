// FILE: authSessionBootstrap.ts
// Purpose: Prevents the authenticated WebSocket transport from starting without a valid session.

interface AuthSessionBootstrapDependencies {
  readonly fetch: typeof globalThis.fetch;
  readonly renderPairingRequired: () => void;
}

export type AuthSessionBootstrapResult = "authenticated" | "pairing-required" | "unavailable";

function renderPairingRequiredScreen(): void {
  const root = document.getElementById("root");
  if (!root) return;

  document.title = "Pairing required · Trunk";
  root.innerHTML = `
    <main aria-labelledby="pairing-required-title" style="min-height:100vh;box-sizing:border-box;display:grid;place-items:center;padding:32px;background:#10110f;color:#f3f0e8;font-family:'DM Sans',sans-serif">
      <section style="position:relative;width:min(100%,560px);overflow:hidden;border:1px solid #373a34;background:#171915;padding:clamp(30px,6vw,56px);box-shadow:12px 12px 0 #080907">
        <div aria-hidden="true" style="position:absolute;inset:0 0 auto auto;width:128px;height:8px;background:#d6ff55"></div>
        <p style="margin:0 0 22px;color:#d6ff55;font:600 12px/1.2 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase">Pairing required</p>
        <h1 id="pairing-required-title" tabindex="-1" style="max-width:470px;margin:0;color:#fffdf7;font-size:clamp(36px,7vw,58px);font-weight:600;line-height:.96;letter-spacing:-.05em">Connect this browser to Trunk.</h1>
        <p style="max-width:440px;margin:26px 0 0;color:#b8bbb2;font-size:16px;line-height:1.65">Open the current one-time pairing link shown by the Trunk server. If the server was restarted, use its newly generated link.</p>
      </section>
    </main>`;
  root.querySelector<HTMLElement>("h1")?.focus();
}

export async function bootstrapAuthSession(
  dependencies: AuthSessionBootstrapDependencies = {
    fetch: globalThis.fetch,
    renderPairingRequired: renderPairingRequiredScreen,
  },
): Promise<AuthSessionBootstrapResult> {
  try {
    const response = await dependencies.fetch.call(globalThis, "/api/auth/session", {
      credentials: "same-origin",
    });
    if (!response.ok) return "unavailable";
    const session = (await response.json()) as { readonly authenticated?: unknown };
    if (session.authenticated === true) return "authenticated";
    dependencies.renderPairingRequired();
    return "pairing-required";
  } catch {
    return "unavailable";
  }
}
