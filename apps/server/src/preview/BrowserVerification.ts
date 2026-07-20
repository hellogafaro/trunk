export type BrowserVerificationProvider = "authentication" | "captcha" | "cloudflare";

export interface BrowserVerification {
  readonly provider: BrowserVerificationProvider;
  readonly reason: string;
}

const includesAny = (value: string, candidates: readonly string[]): boolean =>
  candidates.some((candidate) => value.includes(candidate));

export const detectBrowserVerification = (input: {
  readonly bodyText?: string;
  readonly frameUrls?: readonly string[];
  readonly hasSensitiveInput?: boolean;
  readonly title?: string;
  readonly url: string;
}): BrowserVerification | null => {
  const url = input.url.toLowerCase();
  const title = input.title?.toLowerCase() ?? "";
  const bodyText = input.bodyText?.toLowerCase() ?? "";
  const frameUrls = input.frameUrls?.map((frameUrl) => frameUrl.toLowerCase()) ?? [];
  const combined = `${title}\n${bodyText}`;

  if (
    includesAny(url, ["/cdn-cgi/challenge-platform/", "challenges.cloudflare.com"]) ||
    frameUrls.some((frameUrl) => frameUrl.includes("challenges.cloudflare.com")) ||
    includesAny(combined, ["checking your browser", "verify you are human", "cloudflare ray id"])
  ) {
    return {
      provider: "cloudflare",
      reason: "Cloudflare verification requires manual control.",
    };
  }

  if (
    frameUrls.some((frameUrl) =>
      includesAny(frameUrl, ["google.com/recaptcha", "hcaptcha.com", "challenges.cloudflare.com"]),
    ) ||
    includesAny(combined, ["recaptcha", "hcaptcha", "complete the captcha"])
  ) {
    return { provider: "captcha", reason: "Complete the CAPTCHA manually to continue." };
  }

  if (input.hasSensitiveInput) {
    return {
      provider: "authentication",
      reason: "Authentication requires manual control.",
    };
  }

  return null;
};
