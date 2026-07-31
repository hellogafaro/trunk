import { describe, expect, it } from "vite-plus/test";

import html from "../index.html?raw";
import manifestText from "../public/manifest.webmanifest?raw";
import serviceWorker from "../public/service-worker.js?raw";

describe("PWA assets", () => {
  it("declares the required install metadata", () => {
    const manifest = JSON.parse(manifestText) as {
      id?: string;
      name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      icons?: Array<{ sizes?: string }>;
    };

    expect(manifest).toMatchObject({
      id: "/",
      name: "Trunk",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(manifest.icons?.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
  });

  it("keeps private and dynamic routes out of the service-worker cache", () => {
    for (const prefix of ["/.well-known/", "/api/", "/attachments/", "/gateway/", "/v1/"]) {
      expect(serviceWorker).toContain(JSON.stringify(prefix));
    }
    expect(serviceWorker).toContain('request.mode === "navigate"');
    expect(serviceWorker).toContain('caches.match("/")');
  });

  it("allows browser zoom while retaining safe-area and keyboard viewport handling", () => {
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain("interactive-widget=resizes-content");
    expect(html).not.toContain("user-scalable=no");
    expect(html).not.toContain("maximum-scale=1");
  });
});
