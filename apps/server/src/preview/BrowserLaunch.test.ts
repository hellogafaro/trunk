import { describe, expect, it } from "vitest";

import { selectBrowserLaunch } from "./BrowserLaunch.ts";

const existing =
  (...paths: readonly string[]) =>
  async (path: string) =>
    paths.includes(path);

describe("selectBrowserLaunch", () => {
  it("prefers headed stable Chrome when a display is available", async () => {
    await expect(
      selectBrowserLaunch({
        defaultExecutablePath: "/managed/chromium",
        env: { DISPLAY: ":0" },
        pathExists: existing("/usr/bin/google-chrome"),
        platform: "linux",
      }),
    ).resolves.toEqual({
      executablePath: "/usr/bin/google-chrome",
      headless: false,
      kind: "trusted-chrome",
    });
  });

  it("honors an executable override in trusted mode", async () => {
    await expect(
      selectBrowserLaunch({
        defaultExecutablePath: "/managed/chromium",
        env: { DISPLAY: ":0", T3CODE_BROWSER_EXECUTABLE_PATH: " /opt/chrome " },
        pathExists: existing("/opt/chrome"),
        platform: "linux",
      }),
    ).resolves.toMatchObject({ executablePath: "/opt/chrome", kind: "trusted-chrome" });
  });

  it("falls back to managed headless Chromium without a display", async () => {
    await expect(
      selectBrowserLaunch({
        defaultExecutablePath: "/managed/chromium",
        env: {},
        pathExists: existing("/usr/bin/google-chrome-stable"),
        platform: "linux",
      }),
    ).resolves.toEqual({
      executablePath: "/managed/chromium",
      headless: true,
      kind: "managed-chromium",
    });
  });

  it("preserves an explicit executable override without a display", async () => {
    await expect(
      selectBrowserLaunch({
        defaultExecutablePath: "/managed/chromium",
        env: { T3CODE_BROWSER_EXECUTABLE_PATH: "/opt/chrome" },
        pathExists: existing("/opt/chrome"),
        platform: "linux",
      }),
    ).resolves.toEqual({
      executablePath: "/opt/chrome",
      headless: true,
      kind: "managed-chromium",
    });
  });

  it("falls back when stable Chrome is not installed", async () => {
    await expect(
      selectBrowserLaunch({
        defaultExecutablePath: "/managed/chromium",
        env: { DISPLAY: ":0" },
        pathExists: existing(),
        platform: "linux",
      }),
    ).resolves.toMatchObject({ kind: "managed-chromium", headless: true });
  });
});
