import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { automationEnvironmentKey } from "./automations.ts";

describe("automationEnvironmentKey", () => {
  it("is stable across environment ordering", () => {
    const first = EnvironmentId.make("environment-a");
    const second = EnvironmentId.make("environment-b");
    expect(automationEnvironmentKey([second, first])).toBe(
      automationEnvironmentKey([first, second]),
    );
  });

  it("keeps environment identifiers unambiguous", () => {
    expect(
      automationEnvironmentKey([
        EnvironmentId.make("environment-a"),
        EnvironmentId.make("environment-ab"),
      ]),
    ).not.toBe(
      automationEnvironmentKey([
        EnvironmentId.make("environment-aa"),
        EnvironmentId.make("environment-b"),
      ]),
    );
  });
});
