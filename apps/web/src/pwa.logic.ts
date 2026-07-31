export type PwaInstallMethod = "browser-prompt" | "ios-instructions" | null;

export function isIosBrowser(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function resolvePwaInstallMethod(input: {
  readonly alreadyInstalled: boolean;
  readonly browserPromptAvailable: boolean;
  readonly iosBrowser: boolean;
}): PwaInstallMethod {
  if (input.alreadyInstalled) {
    return null;
  }
  if (input.browserPromptAvailable) {
    return "browser-prompt";
  }
  return input.iosBrowser ? "ios-instructions" : null;
}

export function isStandaloneDisplayMode(input: {
  readonly displayModeStandalone: boolean;
  readonly navigatorStandalone: boolean;
}): boolean {
  return input.displayModeStandalone || input.navigatorStandalone;
}
