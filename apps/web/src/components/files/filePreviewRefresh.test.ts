import { describe, expect, it } from "vite-plus/test";

import { nextFilePreviewRefreshTarget } from "./filePreviewRefresh";

describe("nextFilePreviewRefreshTarget", () => {
  const input = {
    lastTarget: null,
    relativePath: "README.md",
    refreshKey: "turn-1:2026-07-21T12:00:00.000Z",
    hasPendingChange: false,
  } as const;

  it("claims a new completed-turn refresh once", () => {
    const target = nextFilePreviewRefreshTarget(input);

    expect(target).not.toBeNull();
    expect(nextFilePreviewRefreshTarget({ ...input, lastTarget: target })).toBeNull();
  });

  it("claims the next completed turn", () => {
    const lastTarget = nextFilePreviewRefreshTarget(input);

    expect(
      nextFilePreviewRefreshTarget({
        ...input,
        lastTarget,
        refreshKey: "turn-2:2026-07-21T12:01:00.000Z",
      }),
    ).not.toBeNull();
  });

  it("defers while a local edit is pending and claims it after the save", () => {
    expect(nextFilePreviewRefreshTarget({ ...input, hasPendingChange: true })).toBeNull();
    expect(nextFilePreviewRefreshTarget(input)).not.toBeNull();
  });

  it("does not refresh without an open file or completed turn", () => {
    expect(nextFilePreviewRefreshTarget({ ...input, relativePath: null })).toBeNull();
    expect(nextFilePreviewRefreshTarget({ ...input, refreshKey: null })).toBeNull();
  });
});
