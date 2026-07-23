import { expect, it } from "@effect/vitest";
import { Tool } from "effect/unstable/ai";

import { AutomationToolkit } from "./tools.ts";

it("exports provider-compatible object parameter schemas", () => {
  for (const tool of Object.values(AutomationToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
    };
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
  }
});
