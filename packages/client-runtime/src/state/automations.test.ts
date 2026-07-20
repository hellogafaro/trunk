import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { AsyncResult } from "effect/unstable/reactivity";

import { automationEnvironmentKey, isAutomationSnapshotLoading } from "./automations.ts";

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

describe("isAutomationSnapshotLoading", () => {
  it("stops loading as soon as an empty subscription snapshot arrives", () => {
    const snapshot = { automations: [], runs: [], updatedAt: "2026-07-20T12:00:00.000Z" } as const;
    expect(isAutomationSnapshotLoading(AsyncResult.success(snapshot, { waiting: true }))).toBe(
      false,
    );
  });

  it("loads while the subscription has not produced its first value", () => {
    expect(isAutomationSnapshotLoading(AsyncResult.initial(true))).toBe(true);
  });
});
