import { describe, expect, it } from "vite-plus/test";

import { isIosBrowser, isStandaloneDisplayMode, resolvePwaInstallMethod } from "./pwa.logic";

describe("PWA platform logic", () => {
  it("detects iOS and iPadOS desktop-mode browsers", () => {
    expect(isIosBrowser("Mozilla/5.0 (iPhone)", "iPhone", 5)).toBe(true);
    expect(isIosBrowser("Mozilla/5.0 (Macintosh)", "MacIntel", 5)).toBe(true);
    expect(isIosBrowser("Mozilla/5.0 (Macintosh)", "MacIntel", 0)).toBe(false);
  });

  it("prefers the browser install prompt and falls back to iOS instructions", () => {
    expect(
      resolvePwaInstallMethod({
        alreadyInstalled: false,
        browserPromptAvailable: true,
        iosBrowser: true,
      }),
    ).toBe("browser-prompt");
    expect(
      resolvePwaInstallMethod({
        alreadyInstalled: false,
        browserPromptAvailable: false,
        iosBrowser: true,
      }),
    ).toBe("ios-instructions");
    expect(
      resolvePwaInstallMethod({
        alreadyInstalled: true,
        browserPromptAvailable: true,
        iosBrowser: true,
      }),
    ).toBeNull();
  });

  it("recognizes both standards-based and iOS standalone modes", () => {
    expect(
      isStandaloneDisplayMode({
        displayModeStandalone: true,
        navigatorStandalone: false,
      }),
    ).toBe(true);
    expect(
      isStandaloneDisplayMode({
        displayModeStandalone: false,
        navigatorStandalone: true,
      }),
    ).toBe(true);
  });
});
