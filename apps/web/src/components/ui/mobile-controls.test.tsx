import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Button } from "./button";
import { Input } from "./input";
import { Toggle } from "./toggle";

describe("mobile control sizing", () => {
  it("uses real 44px mobile button targets", () => {
    const html = renderToStaticMarkup(
      <>
        <Button size="icon-sm" aria-label="Example" />
        <Button size="xs">Compact action</Button>
      </>,
    );

    expect(html).toContain("size-11");
    expect(html).toContain("h-11");
    expect(html).toContain("md:size-7");
    expect(html).toContain("md:h-6");
  });

  it("uses real 44px mobile toggle and input targets", () => {
    const html = renderToStaticMarkup(
      <>
        <Toggle size="sm" aria-label="Example toggle" />
        <Input size="sm" aria-label="Example input" />
      </>,
    );

    expect(html).toContain("min-w-11");
    expect(html).toContain("h-11");
    expect(html).toContain("leading-11");
  });
});
