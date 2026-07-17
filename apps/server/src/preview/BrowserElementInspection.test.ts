import { describe, expect, it } from "vite-plus/test";

import { browserElementsAtPointExpression } from "./BrowserElementInspection.ts";

describe("browserElementsAtPointExpression", () => {
  it("rounds and clamps coordinates before embedding them", () => {
    const expression = browserElementsAtPointExpression(-12.4, 42.7);
    expect(expression).toContain("document.elementsFromPoint(0, 43)");
  });

  it("falls back safely for non-finite coordinates", () => {
    const expression = browserElementsAtPointExpression(Number.NaN, Number.POSITIVE_INFINITY);
    expect(expression).toContain("document.elementsFromPoint(0, 0)");
  });

  it("produces a syntactically valid browser expression", () => {
    const expression = browserElementsAtPointExpression(120, 240);
    expect(() => Function(`return ${expression};`)).not.toThrow();
  });
});
