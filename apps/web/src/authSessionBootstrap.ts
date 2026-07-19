// FILE: authSessionBootstrap.ts
// Purpose: Prevents the authenticated WebSocket transport from starting without a valid session.

import { SYNARA_LOGO_PATHS } from "./assets/synaraLogoPath";

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
      <section style="width:min(100%,440px)">
        <svg aria-label="Trunk" viewBox="0 0 880 880" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 0 28px;color:#f3f0e8">
          ${SYNARA_LOGO_PATHS.map((path) => `<path d="${path}" fill="currentColor"></path>`).join("")}
        </svg>
        <h1 id="pairing-required-title" tabindex="-1" style="margin:0;color:#f3f0e8;font-size:clamp(28px,5vw,36px);font-weight:500;line-height:1.08;letter-spacing:-.035em">Pairing required</h1>
        <p style="max-width:420px;margin:16px 0 0;color:#858780;font-size:15px;line-height:1.6">Open the current one-time pairing link shown by the Trunk server. If the server was restarted, use its newly generated link.</p>
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
