import { describe, expect, it } from "vite-plus/test";

import {
  BROWSER_QUICK_VIEWPORTS,
  browserQuickViewportValue,
  browserViewportMode,
} from "./browserQuickViewports";

describe("browserQuickViewportValue", () => {
  it("recognizes the three quick viewport settings", () => {
    expect(browserQuickViewportValue(BROWSER_QUICK_VIEWPORTS.mobile.setting)).toBe("mobile");
    expect(browserQuickViewportValue(BROWSER_QUICK_VIEWPORTS.tablet.setting)).toBe("tablet");
    expect(browserQuickViewportValue(BROWSER_QUICK_VIEWPORTS.desktop.setting)).toBe("desktop");
  });

  it("keeps a rotated quick viewport selected", () => {
    expect(
      browserQuickViewportValue({
        ...BROWSER_QUICK_VIEWPORTS.mobile.setting,
        width: BROWSER_QUICK_VIEWPORTS.mobile.setting.height,
        height: BROWSER_QUICK_VIEWPORTS.mobile.setting.width,
      }),
    ).toBe("mobile");
    expect(browserQuickViewportValue({ _tag: "freeform", width: 900, height: 1440 })).toBe(
      "desktop",
    );
  });

  it("leaves a custom viewport unselected", () => {
    expect(browserQuickViewportValue({ _tag: "freeform", width: 1180, height: 760 })).toBeNull();
  });

  it("maps full and legacy custom settings to a chrome-row mode", () => {
    expect(browserViewportMode({ _tag: "fill" })).toBe("full");
    expect(browserViewportMode({ _tag: "freeform", width: 1180, height: 760 })).toBe("desktop");
  });
});
