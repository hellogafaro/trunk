import type { PreviewViewportSetting } from "@t3tools/contracts";

export type BrowserQuickViewport = "mobile" | "tablet" | "desktop";

interface BrowserQuickViewportDefinition {
  readonly label: string;
  readonly detail: string;
  readonly setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>;
}

export const BROWSER_QUICK_VIEWPORTS = {
  mobile: {
    label: "Mobile",
    detail: "390 × 844",
    setting: {
      _tag: "preset",
      presetId: "iphone-12-pro",
      width: 390,
      height: 844,
    },
  },
  tablet: {
    label: "Tablet",
    detail: "768 × 1024",
    setting: {
      _tag: "preset",
      presetId: "ipad-mini",
      width: 768,
      height: 1024,
    },
  },
  desktop: {
    label: "Desktop",
    detail: "1440 × 900",
    setting: { _tag: "freeform", width: 1440, height: 900 },
  },
} as const satisfies Record<BrowserQuickViewport, BrowserQuickViewportDefinition>;

export const browserQuickViewportValue = (
  setting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>,
): BrowserQuickViewport | null => {
  if (setting._tag === "preset") {
    if (setting.presetId === BROWSER_QUICK_VIEWPORTS.mobile.setting.presetId) return "mobile";
    if (setting.presetId === BROWSER_QUICK_VIEWPORTS.tablet.setting.presetId) return "tablet";
    return null;
  }

  const desktop = BROWSER_QUICK_VIEWPORTS.desktop.setting;
  const matchesDesktop = setting.width === desktop.width && setting.height === desktop.height;
  const matchesRotatedDesktop =
    setting.width === desktop.height && setting.height === desktop.width;
  return matchesDesktop || matchesRotatedDesktop ? "desktop" : null;
};
