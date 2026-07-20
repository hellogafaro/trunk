import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  DiscoveredLocalServer,
  PreviewBrowserCursor,
  PreviewBrowserFrame,
  PreviewBrowserInput,
  PreviewBrowserInspectResult,
  PreviewEvent,
  PreviewNavStatus,
  PreviewSessionSnapshot,
  PreviewViewportSetting,
} from "./preview.ts";
import {
  PreviewAutomationHost,
  PreviewAutomationError,
  PreviewAutomationOpenInput,
  PreviewAutomationResizeInput,
  PreviewAutomationResizeResult,
  PreviewAutomationStatus,
} from "./previewAutomation.ts";

const decodePreviewEvent = Schema.decodeUnknownSync(PreviewEvent);
const decodeSnapshot = Schema.decodeUnknownSync(PreviewSessionSnapshot);
const decodeNavStatus = Schema.decodeUnknownSync(PreviewNavStatus);
const decodeServer = Schema.decodeUnknownSync(DiscoveredLocalServer);
const decodeViewport = Schema.decodeUnknownSync(PreviewViewportSetting);
const decodeResizeInput = Schema.decodeUnknownSync(PreviewAutomationResizeInput);
const decodeOpenInput = Schema.decodeUnknownSync(PreviewAutomationOpenInput);
const decodeResizeResult = Schema.decodeUnknownSync(PreviewAutomationResizeResult);
const decodeAutomationHost = Schema.decodeUnknownSync(PreviewAutomationHost);
const decodeAutomationError = Schema.decodeUnknownSync(PreviewAutomationError);
const decodeAutomationStatus = Schema.decodeUnknownSync(PreviewAutomationStatus);
const decodeBrowserInspectResult = Schema.decodeUnknownSync(PreviewBrowserInspectResult);
const decodeBrowserFrame = Schema.decodeUnknownSync(PreviewBrowserFrame);
const decodeBrowserCursor = Schema.decodeUnknownSync(PreviewBrowserCursor);
const decodeBrowserInput = Schema.decodeUnknownSync(PreviewBrowserInput);

describe("PreviewBrowserFrame", () => {
  it("decodes image frames without cursor payloads", () => {
    expect(
      decodeBrowserFrame({
        _tag: "Frame",
        threadId: "thread-1",
        tabId: "tab_1",
        sequence: 2,
        mimeType: "image/jpeg",
        data: "frame-data",
        width: 1280,
        height: 800,
      }).data,
    ).toBe("frame-data");
  });

  it("decodes cursor updates independently from image data", () => {
    const cursor = decodeBrowserCursor({
      _tag: "Cursor",
      threadId: "thread-1",
      tabId: "tab_1",
      sequence: 3,
      phase: "click",
      x: 40,
      y: 60,
    });
    expect(cursor).toMatchObject({ phase: "click", x: 40, y: 60 });
    expect(cursor).not.toHaveProperty("data");
  });
});

describe("PreviewBrowserInput", () => {
  it("accepts bounded click counts for native double and triple clicks", () => {
    const input = decodeBrowserInput({
      threadId: "thread-1",
      tabId: "tab_1",
      kind: "pointer",
      action: "down",
      x: 40,
      y: 60,
      button: "left",
      clickCount: 2,
    });
    expect(input.kind === "pointer" ? input.clickCount : undefined).toBe(2);
    expect(() =>
      decodeBrowserInput({
        threadId: "thread-1",
        tabId: "tab_1",
        kind: "pointer",
        action: "down",
        x: 40,
        y: 60,
        clickCount: 4,
      }),
    ).toThrow();
  });
});

describe("PreviewBrowserInspectResult", () => {
  it("decodes structured element context and viewport bounds", () => {
    expect(
      decodeBrowserInspectResult([
        {
          element: {
            pageUrl: "https://example.com",
            pageTitle: "Example",
            tagName: "button",
            selector: "#submit",
            htmlPreview: '<button id="submit">Save</button>',
            componentName: "SaveButton",
            source: null,
            stack: [],
            styles: "display: inline-flex;",
            pickedAt: "2026-07-17T00:00:00.000Z",
          },
          rect: { x: 20, y: 30, width: 120, height: 32 },
        },
      ])[0]?.element.componentName,
    ).toBe("SaveButton");
  });
});

describe("PreviewNavStatus", () => {
  it("decodes Idle", () => {
    expect(decodeNavStatus({ _tag: "Idle" })).toEqual({ _tag: "Idle" });
  });

  it("decodes Loading with title", () => {
    expect(decodeNavStatus({ _tag: "Loading", url: "http://localhost:5173/", title: "" })).toEqual({
      _tag: "Loading",
      url: "http://localhost:5173/",
      title: "",
    });
  });

  it("decodes LoadFailed with code/description", () => {
    expect(
      decodeNavStatus({
        _tag: "LoadFailed",
        url: "https://example.com/",
        title: "Example",
        code: -105,
        description: "ERR_NAME_NOT_RESOLVED",
      }),
    ).toEqual({
      _tag: "LoadFailed",
      url: "https://example.com/",
      title: "Example",
      code: -105,
      description: "ERR_NAME_NOT_RESOLVED",
    });
  });

  it("rejects empty url", () => {
    expect(() => decodeNavStatus({ _tag: "Loading", url: "", title: "" })).toThrow();
  });
});

describe("PreviewSessionSnapshot", () => {
  it("decodes an optional manual verification state", () => {
    const snapshot = decodeSnapshot({
      threadId: "thread-1",
      tabId: "preview-1",
      navStatus: { _tag: "Success", url: "https://example.com/login", title: "Login" },
      canGoBack: false,
      canGoForward: false,
      verification: {
        provider: "authentication",
        reason: "Authentication requires manual control.",
      },
      updatedAt: "2026-07-20T12:00:00.000Z",
    });

    expect(snapshot.verification?.provider).toBe("authentication");
  });

  it("round-trips a Success snapshot", () => {
    const snapshot = decodeSnapshot({
      threadId: "thread-1",
      tabId: "preview-thread-1",
      navStatus: {
        _tag: "Success",
        url: "http://localhost:5173/",
        title: "Vite App",
      },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(snapshot.tabId).toBe("preview-thread-1");
    expect(snapshot.navStatus._tag).toBe("Success");
  });
});

describe("PreviewViewportSetting", () => {
  it("decodes fill, freeform, and preset modes", () => {
    expect(decodeViewport({ _tag: "fill" })).toEqual({ _tag: "fill" });
    expect(decodeViewport({ _tag: "freeform", width: 1024, height: 768 })).toEqual({
      _tag: "freeform",
      width: 1024,
      height: 768,
    });
    expect(
      decodeViewport({
        _tag: "preset",
        presetId: "iphone-15-pro",
        width: 393,
        height: 852,
      }),
    ).toMatchObject({ _tag: "preset", presetId: "iphone-15-pro" });
  });

  it("rejects unsafe dimensions and oversized render areas", () => {
    expect(() => decodeViewport({ _tag: "freeform", width: 100, height: 800 })).toThrow();
    expect(() => decodeViewport({ _tag: "freeform", width: 3840, height: 3840 })).toThrow();
  });
});

describe("PreviewAutomationResizeInput", () => {
  it("requires fields that match the selected mode", () => {
    expect(decodeResizeInput({ mode: "fill" })).toEqual({ mode: "fill" });
    expect(
      decodeResizeInput({ mode: "preset", preset: "pixel-7", orientation: "landscape" }),
    ).toMatchObject({ mode: "preset", preset: "pixel-7" });
    expect(() => decodeResizeInput({ mode: "preset", preset: "pixel-8" })).toThrow();
    expect(() => decodeResizeInput({ mode: "freeform", width: 1024 })).toThrow();
    expect(() => decodeResizeInput({ mode: "fill", width: 1024, height: 768 })).toThrow();
  });

  it("allows fill-mode measurements below the minimum selectable fixed size", () => {
    expect(
      decodeResizeResult({
        tabId: "preview-t",
        setting: { _tag: "fill" },
        viewport: { width: 180, height: 120 },
      }).viewport,
    ).toEqual({ width: 180, height: 120 });
  });
});

describe("preview automation tab targeting", () => {
  it("accepts an explicit tab and rejects contradictory open behavior", () => {
    expect(decodeResizeInput({ tabId: "tab-app", mode: "fill" })).toMatchObject({
      tabId: "tab-app",
      mode: "fill",
    });
    expect(decodeOpenInput({ tabId: "tab-app", reuseExistingTab: true })).toMatchObject({
      tabId: "tab-app",
      reuseExistingTab: true,
    });
    expect(() => decodeOpenInput({ tabId: "tab-app", reuseExistingTab: false })).toThrow();
  });
});

describe("PreviewAutomationHost", () => {
  it("accepts legacy hosts and current operation advertisements", () => {
    expect(decodeAutomationHost({ clientId: "legacy", environmentId: "environment-1" })).toEqual({
      clientId: "legacy",
      environmentId: "environment-1",
    });
    expect(
      decodeAutomationHost({
        clientId: "current",
        environmentId: "environment-1",
        supportedOperations: ["status", "resize"],
      }).supportedOperations,
    ).toEqual(["status", "resize"]);
  });
});

describe("PreviewAutomationError", () => {
  it("preserves a typed non-editable target failure", () => {
    const error = decodeAutomationError({
      _tag: "PreviewAutomationTargetNotEditableError",
      operation: "type",
      environmentId: "environment-1",
      threadId: "thread-1",
      providerSessionId: "provider-session-1",
      providerInstanceId: "codex",
      clientId: "client-1",
      connectionId: "connection-1",
      requestId: "request-1",
      tabId: "tab-1",
      timeoutMs: 1_000,
      remoteTag: "PreviewAutomationTargetNotEditableError",
      remoteMessageLength: 12,
      cause: {},
      selectorKind: "focused-element",
    });

    expect(error._tag).toBe("PreviewAutomationTargetNotEditableError");
    if (error._tag === "PreviewAutomationTargetNotEditableError") {
      expect(error.selectorKind).toBe("focused-element");
      expect(error.message).toBe("Preview automation type requires an editable focused element.");
    }
  });
});

describe("PreviewAutomationStatus", () => {
  it("accepts old hosts without viewport data and exposes it from current hosts", () => {
    const base = {
      available: true,
      visible: false,
      tabId: "preview-t",
      url: "https://example.com",
      title: "Example",
      loading: false,
    };
    expect(decodeAutomationStatus(base)).toEqual(base);
    expect(
      decodeAutomationStatus({
        ...base,
        viewportSetting: { _tag: "preset", presetId: "pixel-8", width: 412, height: 915 },
        viewport: { width: 412, height: 915 },
      }).viewport,
    ).toEqual({ width: 412, height: 915 });
  });
});

describe("PreviewEvent", () => {
  it("decodes opened", () => {
    const event = decodePreviewEvent({
      type: "opened",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
      snapshot: {
        threadId: "t",
        tabId: "preview-t",
        navStatus: { _tag: "Idle" },
        canGoBack: false,
        canGoForward: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(event.type).toBe("opened");
  });

  it("decodes failed with code/description", () => {
    const event = decodePreviewEvent({
      type: "failed",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
      url: "https://example.com/",
      title: "",
      code: -105,
      description: "ERR_NAME_NOT_RESOLVED",
    });
    expect(event.type).toBe("failed");
    if (event.type === "failed") {
      expect(event.code).toBe(-105);
    }
  });

  it("decodes resized with tab viewport state", () => {
    const event = decodePreviewEvent({
      type: "resized",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
      snapshot: {
        threadId: "t",
        tabId: "preview-t",
        navStatus: { _tag: "Idle" },
        canGoBack: false,
        canGoForward: false,
        viewport: { _tag: "freeform", width: 1024, height: 768 },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(event.type).toBe("resized");
  });

  it("decodes closed without snapshot", () => {
    const event = decodePreviewEvent({
      type: "closed",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(event.type).toBe("closed");
  });

  it("decodes an automation presentation request", () => {
    const event = decodePreviewEvent({
      type: "automationPresented",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(event.type).toBe("automationPresented");
  });
});

describe("DiscoveredLocalServer", () => {
  it("decodes a server with process metadata", () => {
    const server = decodeServer({
      host: "localhost",
      port: 5173,
      url: "http://localhost:5173",
      processName: "node",
      pid: 12345,
      terminal: null,
    });
    expect(server.port).toBe(5173);
    expect(server.processName).toBe("node");
  });

  it("decodes a server without process metadata", () => {
    const server = decodeServer({
      host: "localhost",
      port: 3000,
      url: "http://localhost:3000",
      processName: null,
      pid: null,
      terminal: null,
    });
    expect(server.processName).toBeNull();
  });

  it("rejects invalid ports", () => {
    expect(() =>
      decodeServer({
        host: "localhost",
        port: 0,
        url: "http://localhost:0",
        processName: null,
        pid: null,
        terminal: null,
      }),
    ).toThrow();
    expect(() =>
      decodeServer({
        host: "localhost",
        port: 70000,
        url: "http://localhost:70000",
        processName: null,
        pid: null,
        terminal: null,
      }),
    ).toThrow();
  });
});
