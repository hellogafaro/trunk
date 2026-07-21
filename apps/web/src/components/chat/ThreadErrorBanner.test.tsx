import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ThreadErrorBanner } from "./ThreadErrorBanner";

describe("ThreadErrorBanner", () => {
  it("renders the error in the alert content slot", () => {
    const error = "Your account is temporarily unavailable.";
    const markup = renderToStaticMarkup(<ThreadErrorBanner error={error} onDismiss={() => {}} />);

    expect(markup).toContain('data-slot="alert-description"');
    expect(markup).toContain('data-slot="alert-description"><span class="line-clamp-3"');
    expect(markup).toContain(error);
  });
});
