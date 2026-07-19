import { describe, expect, it, vi } from "vitest";

import { bootstrapAuthSession } from "./authSessionBootstrap";

describe("bootstrapAuthSession", () => {
  it("allows the app to load for an authenticated browser", async () => {
    const renderPairingRequired = vi.fn();
    const fetch = vi.fn(async () =>
      Response.json({ authenticated: true, auth: { policy: "remote-reachable" } }),
    );

    await expect(
      bootstrapAuthSession({ fetch: fetch as typeof globalThis.fetch, renderPairingRequired }),
    ).resolves.toBe("authenticated");
    expect(fetch).toHaveBeenCalledWith("/api/auth/session", { credentials: "same-origin" });
    expect(renderPairingRequired).not.toHaveBeenCalled();
  });

  it("stops app startup and renders pairing guidance for a stale session", async () => {
    const renderPairingRequired = vi.fn();
    const fetch = vi.fn(async () =>
      Response.json({ authenticated: false, auth: { policy: "remote-reachable" } }),
    );

    await expect(
      bootstrapAuthSession({ fetch: fetch as typeof globalThis.fetch, renderPairingRequired }),
    ).resolves.toBe("pairing-required");
    expect(renderPairingRequired).toHaveBeenCalledOnce();
  });

  it("lets the app show its normal connection recovery when the session probe is unavailable", async () => {
    const renderPairingRequired = vi.fn();
    const fetch = vi.fn(async () => {
      throw new Error("network unavailable");
    });

    await expect(
      bootstrapAuthSession({ fetch: fetch as typeof globalThis.fetch, renderPairingRequired }),
    ).resolves.toBe("unavailable");
    expect(renderPairingRequired).not.toHaveBeenCalled();
  });
});
