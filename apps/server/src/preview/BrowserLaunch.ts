// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

export interface BrowserLaunchSelection {
  readonly executablePath: string;
  readonly headless: boolean;
  readonly kind: "managed-chromium" | "trusted-chrome";
}

const stableChromeCandidates = (
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] => {
  if (platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (platform === "win32") {
    return [env["PROGRAMFILES"], env["PROGRAMFILES(X86)"], env["LOCALAPPDATA"]].flatMap((base) =>
      base ? [NodePath.join(base, "Google", "Chrome", "Application", "chrome.exe")] : [],
    );
  }
  return ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"];
};

const hasGraphicalDisplay = (
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): boolean =>
  platform === "darwin" ||
  platform === "win32" ||
  Boolean(env["DISPLAY"]?.trim() || env["WAYLAND_DISPLAY"]?.trim());

export const selectBrowserLaunch = async (input: {
  readonly defaultExecutablePath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly pathExists: (path: string) => Promise<boolean>;
  readonly platform: NodeJS.Platform;
}): Promise<BrowserLaunchSelection> => {
  const platform = input.platform;
  const configuredPath = input.env["T3CODE_BROWSER_EXECUTABLE_PATH"]?.trim();
  const candidates = configuredPath
    ? [configuredPath]
    : stableChromeCandidates(platform, input.env);

  if (hasGraphicalDisplay(platform, input.env)) {
    for (const executablePath of candidates) {
      if (await input.pathExists(executablePath)) {
        return { executablePath, headless: false, kind: "trusted-chrome" };
      }
    }
  }

  if (configuredPath && (await input.pathExists(configuredPath))) {
    return { executablePath: configuredPath, headless: true, kind: "managed-chromium" };
  }

  return {
    executablePath: input.defaultExecutablePath,
    headless: true,
    kind: "managed-chromium",
  };
};
