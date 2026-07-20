import { describe, expect, it } from "vitest";

import { detectBrowserVerification } from "./BrowserVerification.ts";

describe("detectBrowserVerification", () => {
  it("detects Cloudflare challenge frames", () => {
    expect(
      detectBrowserVerification({
        url: "https://dash.cloudflare.com/",
        frameUrls: ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile"],
      }),
    ).toMatchObject({ provider: "cloudflare" });
  });

  it("detects common CAPTCHA providers", () => {
    expect(
      detectBrowserVerification({
        url: "https://example.com/login",
        frameUrls: ["https://www.google.com/recaptcha/api2/anchor"],
      }),
    ).toMatchObject({ provider: "captcha" });
  });

  it("requires manual control for sensitive authentication inputs", () => {
    expect(
      detectBrowserVerification({ url: "https://example.com/login", hasSensitiveInput: true }),
    ).toMatchObject({ provider: "authentication" });
  });

  it("does not flag ordinary pages", () => {
    expect(
      detectBrowserVerification({ url: "https://example.com/", bodyText: "Welcome" }),
    ).toBeNull();
  });
});
