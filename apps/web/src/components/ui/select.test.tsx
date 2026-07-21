import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Select, SelectItem } from "./select";

describe("SelectItem", () => {
  it("keeps option text in the flexible column and renders one selection indicator", () => {
    const markup = renderToStaticMarkup(
      <Select defaultValue="full-access">
        <SelectItem value="full-access">Full access</SelectItem>
      </Select>,
    );

    expect(markup).toContain('data-slot="select-item-text"');
    expect(markup).toContain("col-start-1 min-w-0");
    expect(markup.match(/data-slot="select-item-indicator"/g)).toHaveLength(1);
  });
});
