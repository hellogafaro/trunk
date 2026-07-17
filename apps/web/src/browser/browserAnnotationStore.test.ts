import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  cancelBrowserAnnotation,
  startBrowserAnnotation,
  toggleBrowserAnnotation,
  useBrowserAnnotationStore,
} from "./browserAnnotationStore";

describe("browserAnnotationStore", () => {
  beforeEach(() => useBrowserAnnotationStore.setState({ activeByTabId: {} }));

  it("isolates annotation sessions by browser tab", () => {
    startBrowserAnnotation("tab-a");
    startBrowserAnnotation("tab-b");
    cancelBrowserAnnotation("tab-a");

    expect(useBrowserAnnotationStore.getState().activeByTabId).toEqual({ "tab-b": true });
  });

  it("toggles a session without affecting other tabs", () => {
    startBrowserAnnotation("tab-a");
    toggleBrowserAnnotation("tab-b");
    toggleBrowserAnnotation("tab-a");

    expect(useBrowserAnnotationStore.getState().activeByTabId).toEqual({ "tab-b": true });
  });
});
