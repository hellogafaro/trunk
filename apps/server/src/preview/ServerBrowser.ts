// @effect-diagnostics nodeBuiltinImport:off
import {
  type PreviewAutomationActionEvent,
  type PreviewAutomationClickInput,
  type PreviewAutomationConsoleEntry,
  type PreviewAutomationEvaluateInput,
  type PreviewAutomationNetworkEntry,
  type PreviewAutomationPressInput,
  type PreviewAutomationRecordingArtifact,
  type PreviewAutomationRecordingStatus,
  type PreviewAutomationScrollInput,
  type PreviewAutomationSnapshot,
  type PreviewAutomationStatus,
  type PreviewAutomationTypeInput,
  type PreviewAutomationWaitForInput,
  type PreviewBrowserFrame,
  type PreviewBrowserHistoryInput,
  type PreviewBrowserInspectInput,
  type PreviewBrowserInspectResult,
  type PreviewBrowserInput,
  PreviewBrowserOperationError,
  type PreviewBrowserViewportInput,
  type PreviewReportStatusInput,
  type PreviewSessionSnapshot,
  PreviewBrowserUnavailableError,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { BrowserContext, CDPSession, ConsoleMessage, Page, Request } from "playwright-core";

import { browserElementsAtPointExpression } from "./BrowserElementInspection.ts";

type ServerBrowserError = PreviewBrowserUnavailableError | PreviewBrowserOperationError;

interface BrowserTab {
  readonly key: string;
  readonly threadId: ThreadId;
  readonly tabId: string;
  readonly page: Page;
  readonly cdp: CDPSession;
  readonly frames: PubSub.PubSub<PreviewBrowserFrame>;
  readonly consoleEntries: PreviewAutomationConsoleEntry[];
  readonly networkEntries: PreviewAutomationNetworkEntry[];
  readonly actionTimeline: PreviewAutomationActionEvent[];
  width: number;
  height: number;
  sequence: number;
  cursorX: number;
  cursorY: number;
  cursorPhase: "move" | "click" | null;
  latestFrameData: string | null;
  screencastStarted: boolean;
  onScreencastFrame: ((event: ScreencastFrameEvent) => void) | null;
}

interface ActiveRecording {
  readonly id: string;
  readonly tab: BrowserTab;
  readonly path: string;
  readonly startedAt: string;
  writePromise: Promise<void>;
}

interface ScreencastFrameEvent {
  readonly data: string;
  readonly sessionId: number;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
const MAX_VISIBLE_TEXT_LENGTH = 20_000;
const MAX_INTERACTIVE_ELEMENTS = 200;
const MAX_EVALUATION_BYTES = 64_000;
const DIAGNOSTIC_BUFFER_LIMIT = 200;
const tabKey = (threadId: string, tabId: string): string => `${threadId}\u0000${tabId}`;

const appendBounded = <A>(entries: A[], entry: A): void => {
  entries.push(entry);
  if (entries.length > DIAGNOSTIC_BUFFER_LIMIT) {
    entries.splice(0, entries.length - DIAGNOSTIC_BUFFER_LIMIT);
  }
};

const isPreviewBrowserOperationError = Schema.is(PreviewBrowserOperationError);

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await NodeFSP.access(path);
    return true;
  } catch {
    return false;
  }
};

const resolveChromiumExecutablePath = async (defaultPath: string): Promise<string> => {
  const configuredPath = process.env["T3CODE_BROWSER_EXECUTABLE_PATH"]?.trim();
  if (configuredPath) return configuredPath;
  if (await pathExists(defaultPath)) return defaultPath;

  const browsersPath =
    process.env["PLAYWRIGHT_BROWSERS_PATH"]?.trim() ||
    NodePath.join(NodeOS.homedir(), ".cache", "ms-playwright");
  const entries = await NodeFSP.readdir(browsersPath, { withFileTypes: true }).catch(() => []);
  const revisions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  const candidates = revisions.flatMap((revision) => {
    if (revision.startsWith("chromium_headless_shell-")) {
      return [
        NodePath.join(
          browsersPath,
          revision,
          "chrome-headless-shell-linux64",
          "chrome-headless-shell",
        ),
      ];
    }
    if (revision.startsWith("chromium-")) {
      return [NodePath.join(browsersPath, revision, "chrome-linux64", "chrome")];
    }
    return [];
  });
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return defaultPath;
};

const operationError = (operation: string, cause: unknown): PreviewBrowserOperationError =>
  new PreviewBrowserOperationError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });

const unavailableError = (cause: unknown): PreviewBrowserUnavailableError =>
  new PreviewBrowserUnavailableError({
    message:
      cause instanceof Error
        ? `Server browser unavailable: ${cause.message}`
        : "Server browser unavailable.",
  });

const initialViewport = (snapshot: PreviewSessionSnapshot) => {
  const viewport = snapshot.viewport;
  return viewport && viewport._tag !== "fill"
    ? { width: viewport.width, height: viewport.height }
    : DEFAULT_VIEWPORT;
};

export class ServerBrowser extends Context.Service<
  ServerBrowser,
  {
    readonly ensure: (snapshot: PreviewSessionSnapshot) => Effect.Effect<void, ServerBrowserError>;
    readonly frames: (
      snapshot: PreviewSessionSnapshot,
    ) => Effect.Effect<Stream.Stream<PreviewBrowserFrame>, ServerBrowserError>;
    readonly navigateIfOpen: (
      threadId: ThreadId,
      tabId: string,
      url: string,
    ) => Effect.Effect<boolean, PreviewBrowserOperationError>;
    readonly refreshIfOpen: (
      threadId: ThreadId,
      tabId: string,
    ) => Effect.Effect<boolean, PreviewBrowserOperationError>;
    readonly resizeIfOpen: (
      threadId: ThreadId,
      tabId: string,
      width: number,
      height: number,
    ) => Effect.Effect<boolean, PreviewBrowserOperationError>;
    readonly close: (threadId: ThreadId, tabId: string) => Effect.Effect<void>;
    readonly sendInput: (
      input: PreviewBrowserInput,
    ) => Effect.Effect<void, PreviewBrowserOperationError>;
    readonly setViewport: (
      input: PreviewBrowserViewportInput,
    ) => Effect.Effect<void, PreviewBrowserOperationError>;
    readonly history: (
      input: PreviewBrowserHistoryInput,
    ) => Effect.Effect<void, PreviewBrowserOperationError>;
    readonly inspect: (
      input: PreviewBrowserInspectInput,
    ) => Effect.Effect<PreviewBrowserInspectResult, PreviewBrowserOperationError>;
    readonly automationStatus: (
      threadId: ThreadId,
      tabId: string,
    ) => Effect.Effect<PreviewAutomationStatus, PreviewBrowserOperationError>;
    readonly automationSnapshot: (
      threadId: ThreadId,
      tabId: string,
    ) => Effect.Effect<PreviewAutomationSnapshot, PreviewBrowserOperationError>;
    readonly automationClick: (
      threadId: ThreadId,
      tabId: string,
      input: PreviewAutomationClickInput,
    ) => Effect.Effect<void, PreviewBrowserOperationError>;
    readonly automationType: (
      threadId: ThreadId,
      tabId: string,
      input: PreviewAutomationTypeInput,
    ) => Effect.Effect<void, PreviewBrowserOperationError>;
    readonly automationPress: (
      threadId: ThreadId,
      tabId: string,
      input: PreviewAutomationPressInput,
    ) => Effect.Effect<void, PreviewBrowserOperationError>;
    readonly automationScroll: (
      threadId: ThreadId,
      tabId: string,
      input: PreviewAutomationScrollInput,
    ) => Effect.Effect<void, PreviewBrowserOperationError>;
    readonly automationEvaluate: (
      threadId: ThreadId,
      tabId: string,
      input: PreviewAutomationEvaluateInput,
    ) => Effect.Effect<unknown, PreviewBrowserOperationError>;
    readonly automationWaitFor: (
      threadId: ThreadId,
      tabId: string,
      input: PreviewAutomationWaitForInput,
    ) => Effect.Effect<void, PreviewBrowserOperationError>;
    readonly automationRecordingStart: (
      threadId: ThreadId,
      tabId: string,
    ) => Effect.Effect<PreviewAutomationRecordingStatus, PreviewBrowserOperationError>;
    readonly automationRecordingStop: (
      tabId?: string,
    ) => Effect.Effect<PreviewAutomationRecordingArtifact, PreviewBrowserOperationError>;
    readonly statusEvents: Stream.Stream<PreviewReportStatusInput>;
  }
>()("t3/preview/ServerBrowser") {}

export const make = Effect.gen(function* ServerBrowserMake() {
  const clock = yield* Clock.Clock;
  const nowMillis = () => clock.currentTimeMillisUnsafe();
  const nowIso = () => DateTime.formatIso(DateTime.makeUnsafe(nowMillis()));
  const tabs = new Map<string, BrowserTab>();
  const statusPubSub = yield* PubSub.sliding<PreviewReportStatusInput>({
    capacity: 64,
    replay: 1,
  });
  let contextPromise: Promise<BrowserContext> | null = null;
  let activeRecording: ActiveRecording | null = null;

  const getContext = async (): Promise<BrowserContext> => {
    if (!contextPromise) {
      contextPromise = (async () => {
        const { chromium } = await import("playwright-core");
        const baseDir =
          process.env["T3CODE_HOME"]?.trim() || NodePath.join(NodeOS.homedir(), ".t3");
        const userDataDir = NodePath.join(baseDir, "browser");
        await NodeFSP.mkdir(userDataDir, { recursive: true });
        const executablePath = await resolveChromiumExecutablePath(chromium.executablePath());
        return await chromium.launchPersistentContext(userDataDir, {
          headless: true,
          viewport: DEFAULT_VIEWPORT,
          executablePath,
          args: ["--disable-dev-shm-usage"],
        });
      })().catch((error) => {
        contextPromise = null;
        throw error;
      });
    }
    return await contextPromise;
  };

  const publishStatus = async (
    tab: BrowserTab,
    kind: "Loading" | "Success" | "LoadFailed",
    failure?: { readonly code: number; readonly description: string },
    urlOverride?: string,
  ): Promise<void> => {
    if (tab.page.isClosed()) return;
    const url = urlOverride ?? tab.page.url();
    if (url === "about:blank") return;
    const title = await tab.page.title().catch(() => "");
    const history = await tab.cdp
      .send("Page.getNavigationHistory")
      .catch(() => ({ currentIndex: 0, entries: [{}] }));
    const currentIndex = Number(history.currentIndex ?? 0);
    const entries = Array.isArray(history.entries) ? history.entries : [];
    const navStatus =
      kind === "LoadFailed"
        ? {
            _tag: "LoadFailed" as const,
            url,
            title,
            code: failure?.code ?? 0,
            description: failure?.description ?? "Page failed to load.",
          }
        : { _tag: kind, url, title };
    PubSub.publishUnsafe(statusPubSub, {
      threadId: tab.threadId,
      tabId: tab.tabId,
      navStatus,
      canGoBack: currentIndex > 0,
      canGoForward: currentIndex < entries.length - 1,
    });
  };

  const frameCursor = (tab: BrowserTab): NonNullable<PreviewBrowserFrame["cursor"]> | undefined =>
    tab.cursorPhase === null
      ? undefined
      : { phase: tab.cursorPhase, x: tab.cursorX, y: tab.cursorY };

  const publishFrame = (
    tab: BrowserTab,
    data: string,
    cursor = frameCursor(tab),
  ): PreviewBrowserFrame => {
    const frame: PreviewBrowserFrame = {
      threadId: tab.threadId,
      tabId: tab.tabId,
      sequence: tab.sequence++,
      mimeType: "image/jpeg",
      data,
      width: tab.width,
      height: tab.height,
      ...(cursor ? { cursor } : {}),
    };
    PubSub.publishUnsafe(tab.frames, frame);
    return frame;
  };

  const publishFallbackFrame = async (tab: BrowserTab): Promise<PreviewBrowserFrame> => {
    const data = await tab.page.screenshot({ type: "jpeg", quality: 72 });
    tab.latestFrameData = Buffer.from(data).toString("base64");
    return publishFrame(tab, tab.latestFrameData);
  };

  const publishCursorFrame = (
    tab: BrowserTab,
    cursor: NonNullable<PreviewBrowserFrame["cursor"]>,
  ): void => {
    tab.cursorX = cursor.x;
    tab.cursorY = cursor.y;
    tab.cursorPhase = cursor.phase;
    if (tab.latestFrameData !== null) publishFrame(tab, tab.latestFrameData, cursor);
  };

  const appendRecordingFrame = (tab: BrowserTab, data: string): void => {
    const recording = activeRecording;
    if (!recording || recording.tab.key !== tab.key) return;
    recording.writePromise = recording.writePromise.then(() =>
      NodeFSP.appendFile(recording.path, Buffer.from(data, "base64")),
    );
  };

  const startLiveScreencast = async (tab: BrowserTab): Promise<void> => {
    if (tab.screencastStarted) return;
    const onFrame = (event: ScreencastFrameEvent): void => {
      void tab.cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
      if (tab.page.isClosed()) return;
      tab.latestFrameData = event.data;
      publishFrame(tab, event.data);
      appendRecordingFrame(tab, event.data);
    };
    tab.onScreencastFrame = onFrame;
    tab.screencastStarted = true;
    tab.cdp.on("Page.screencastFrame", onFrame);
    try {
      await tab.cdp.send("Page.enable");
      await tab.cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 72,
        everyNthFrame: 1,
      });
      void tab.page
        .waitForTimeout(250)
        .then(() => {
          if (tab.latestFrameData === null && !tab.page.isClosed()) {
            return publishFallbackFrame(tab);
          }
          return undefined;
        })
        .catch(() => undefined);
    } catch (cause) {
      tab.screencastStarted = false;
      tab.onScreencastFrame = null;
      tab.cdp.off("Page.screencastFrame", onFrame);
      throw cause;
    }
  };

  const stopLiveScreencast = async (tab: BrowserTab): Promise<void> => {
    if (!tab.screencastStarted) return;
    tab.screencastStarted = false;
    if (tab.onScreencastFrame) {
      tab.cdp.off("Page.screencastFrame", tab.onScreencastFrame);
      tab.onScreencastFrame = null;
    }
    await tab.cdp.send("Page.stopScreencast").catch(() => undefined);
  };

  const navigatePage = async (tab: BrowserTab, url: string): Promise<void> => {
    await publishStatus(tab, "Loading", undefined, url);
    try {
      await tab.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await publishStatus(tab, "Success");
    } catch (cause) {
      await publishStatus(tab, "LoadFailed", {
        code: 0,
        description: cause instanceof Error ? cause.message : "Page failed to load.",
      });
    }
  };

  const ensureTab = (
    snapshot: PreviewSessionSnapshot,
  ): Effect.Effect<BrowserTab, ServerBrowserError> =>
    Effect.gen(function* () {
      const key = tabKey(snapshot.threadId, snapshot.tabId);
      const existing = tabs.get(key);
      if (existing) return existing;

      const frames = yield* PubSub.sliding<PreviewBrowserFrame>({ capacity: 2, replay: 1 });
      const viewport = initialViewport(snapshot);
      const tab = yield* Effect.tryPromise({
        try: async () => {
          const context = await getContext();
          const page = await context.newPage();
          await page.setViewportSize(viewport);
          const cdp = await context.newCDPSession(page);
          const created: BrowserTab = {
            key,
            threadId: ThreadId.make(snapshot.threadId),
            tabId: snapshot.tabId,
            page,
            cdp,
            frames,
            consoleEntries: [],
            networkEntries: [],
            actionTimeline: [],
            width: viewport.width,
            height: viewport.height,
            sequence: 0,
            cursorX: viewport.width / 2,
            cursorY: viewport.height / 2,
            cursorPhase: null,
            latestFrameData: null,
            screencastStarted: false,
            onScreencastFrame: null,
          };
          tabs.set(key, created);

          page.on("load", () => {
            void publishStatus(created, "Success");
          });
          page.on("console", (message: ConsoleMessage) => {
            const location = message.location();
            appendBounded(created.consoleEntries, {
              level: message.type(),
              text: message.text(),
              timestamp: nowIso(),
              ...(location.url ? { source: location.url } : {}),
            });
          });
          page.on("response", (response) => {
            const request = response.request();
            appendBounded(created.networkEntries, {
              url: response.url(),
              method: request.method(),
              status: response.status(),
              failed: false,
              timestamp: nowIso(),
            });
          });
          page.on("requestfailed", (request: Request) => {
            const errorText = request.failure()?.errorText;
            appendBounded(created.networkEntries, {
              url: request.url(),
              method: request.method(),
              status: null,
              failed: true,
              ...(errorText ? { errorText } : {}),
              timestamp: nowIso(),
            });
          });
          page.on("popup", (popup) => {
            void (async () => {
              await popup.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
              const popupUrl = popup.url();
              await popup.close().catch(() => {});
              if (popupUrl && popupUrl !== "about:blank") await navigatePage(created, popupUrl);
            })().catch(() => undefined);
          });
          page.on("close", () => tabs.delete(key));
          await startLiveScreencast(created);
          return created;
        },
        catch: unavailableError,
      });

      const initialUrl = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
      if (initialUrl !== null) {
        yield* Effect.tryPromise({
          try: () => navigatePage(tab, initialUrl),
          catch: (cause) => operationError("navigate", cause),
        });
      }
      return tab;
    });

  const requireTab = (
    threadId: ThreadId,
    tabId: string,
    operation: string,
  ): Effect.Effect<BrowserTab, PreviewBrowserOperationError> => {
    const tab = tabs.get(tabKey(threadId, tabId));
    return tab
      ? Effect.succeed(tab)
      : Effect.fail(operationError(operation, "The hosted browser tab is not connected."));
  };

  const withAutomationAction = async <A>(
    tab: BrowserTab,
    action: string,
    run: () => Promise<A>,
  ): Promise<A> => {
    const startedAt = nowIso();
    const event: PreviewAutomationActionEvent = {
      id: `browser-action-${nowMillis().toString(36)}-${tab.actionTimeline.length.toString(36)}`,
      action,
      status: "running",
      startedAt,
    };
    appendBounded(tab.actionTimeline, event);
    try {
      const result = await run();
      const completed = {
        ...event,
        status: "succeeded" as const,
        completedAt: nowIso(),
      };
      const index = tab.actionTimeline.findIndex((candidate) => candidate.id === event.id);
      if (index >= 0) tab.actionTimeline[index] = completed;
      return result;
    } catch (cause) {
      const completed = {
        ...event,
        status: "failed" as const,
        completedAt: nowIso(),
        error: cause instanceof Error ? cause.message : String(cause),
      };
      const index = tab.actionTimeline.findIndex((candidate) => candidate.id === event.id);
      if (index >= 0) tab.actionTimeline[index] = completed;
      throw cause;
    }
  };

  const automationLocator = (
    tab: BrowserTab,
    input: { readonly locator?: string | undefined; readonly selector?: string | undefined },
  ) => {
    const selector = input.locator ?? input.selector;
    return selector ? tab.page.locator(selector).first() : null;
  };

  const selectorOperationError = (
    operation: string,
    input: { readonly locator?: string | undefined; readonly selector?: string | undefined },
    cause: unknown,
  ): PreviewBrowserOperationError => {
    const message = cause instanceof Error ? cause.message : String(cause);
    const invalidSelector =
      /Error while parsing selector|InvalidSelectorError|Unexpected token|Unknown engine|not a valid selector/i.test(
        message,
      );
    return operationError(
      invalidSelector ? "automation-invalid-selector" : `automation-${operation}`,
      `${input.locator !== undefined ? "locator" : "selector"}: ${message}`,
    );
  };

  const captureAutomationSnapshot = async (tab: BrowserTab): Promise<PreviewAutomationSnapshot> => {
    const pageState = await tab.page.evaluate<{
      url: string;
      title: string;
      loading: boolean;
      visibleText: string;
      interactiveElements: PreviewAutomationSnapshot["interactiveElements"];
    }>(`(() => {
      const selectorFor = (element) => {
        if (element.id) return "#" + CSS.escape(element.id);
        for (const attribute of ["data-testid", "name"]) {
          const value = element.getAttribute(attribute);
          if (value) return element.tagName.toLowerCase() + "[" + attribute + "=" + JSON.stringify(value) + "]";
        }
        const buildParts = (current, parts = []) => {
          if (!current || current.nodeType !== Node.ELEMENT_NODE || parts.length >= 8) return parts;
          const parent = current.parentElement;
          const siblings = parent
            ? Array.from(parent.children).filter((child) => child.tagName === current.tagName)
            : [];
          const base = current.tagName.toLowerCase();
          const part = siblings.length > 1
            ? base + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"
            : base;
          return buildParts(parent, [part, ...parts]);
        };
        return buildParts(element).join(" > ");
      };
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const interactiveElements = Array.from(document.querySelectorAll(
        "a[href],button,input,textarea,select,[role],[tabindex]"
      )).filter(visible).slice(0, ${MAX_INTERACTIVE_ELEMENTS}).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          name: element.getAttribute("aria-label") || element.innerText || element.getAttribute("name") || "",
          selector: selectorFor(element),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      });
      return {
        url: location.href,
        title: document.title,
        loading: document.readyState !== "complete",
        visibleText: (document.body?.innerText || "").slice(0, ${MAX_VISIBLE_TEXT_LENGTH}),
        interactiveElements
      };
    })()`);
    const [accessibilityTree, screenshot] = await Promise.all([
      tab.cdp.send("Accessibility.getFullAXTree"),
      tab.page.screenshot({ type: "png" }),
    ]);
    return {
      ...pageState,
      accessibilityTree,
      consoleEntries: [...tab.consoleEntries],
      networkEntries: [...tab.networkEntries],
      actionTimeline: [...tab.actionTimeline],
      screenshot: {
        mimeType: "image/png",
        data: Buffer.from(screenshot).toString("base64"),
        width: tab.width,
        height: tab.height,
      },
    };
  };

  const navigateIfOpen: ServerBrowser["Service"]["navigateIfOpen"] = Effect.fn(
    "ServerBrowser.navigateIfOpen",
  )(function* (threadId, tabId, url) {
    const tab = tabs.get(tabKey(threadId, tabId));
    if (!tab) return false;
    yield* Effect.tryPromise({
      try: () => navigatePage(tab, url),
      catch: (cause) => operationError("navigate", cause),
    });
    return true;
  });

  const refreshIfOpen: ServerBrowser["Service"]["refreshIfOpen"] = Effect.fn(
    "ServerBrowser.refreshIfOpen",
  )(function* (threadId, tabId) {
    const tab = tabs.get(tabKey(threadId, tabId));
    if (!tab) return false;
    yield* Effect.tryPromise({
      try: async () => {
        await publishStatus(tab, "Loading");
        await tab.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
        await publishStatus(tab, "Success");
      },
      catch: (cause) => operationError("refresh", cause),
    });
    return true;
  });

  const resizeIfOpen: ServerBrowser["Service"]["resizeIfOpen"] = Effect.fn(
    "ServerBrowser.resizeIfOpen",
  )(function* (threadId, tabId, width, height) {
    const tab = tabs.get(tabKey(threadId, tabId));
    if (!tab) return false;
    tab.width = Math.max(1, Math.round(width));
    tab.height = Math.max(1, Math.round(height));
    tab.cursorX = Math.min(tab.width - 1, Math.max(0, tab.cursorX));
    tab.cursorY = Math.min(tab.height - 1, Math.max(0, tab.cursorY));
    yield* Effect.tryPromise({
      try: async () => {
        await tab.page.setViewportSize({ width: tab.width, height: tab.height });
      },
      catch: (cause) => operationError("resize", cause),
    });
    return true;
  });

  const close = (threadId: ThreadId, tabId: string): Effect.Effect<void> =>
    Effect.promise(async () => {
      const key = tabKey(threadId, tabId);
      const tab = tabs.get(key);
      if (!tab) return;
      tabs.delete(key);
      await stopLiveScreencast(tab);
      await tab.page.close().catch(() => undefined);
    });

  const frames: ServerBrowser["Service"]["frames"] = Effect.fn("ServerBrowser.frames")(
    function* (snapshot) {
      const tab = yield* ensureTab(snapshot);
      return Stream.fromPubSub(tab.frames);
    },
  );

  const ensure: ServerBrowser["Service"]["ensure"] = Effect.fn("ServerBrowser.ensure")(
    function* (snapshot) {
      yield* ensureTab(snapshot);
    },
  );

  const sendInput: ServerBrowser["Service"]["sendInput"] = Effect.fn("ServerBrowser.sendInput")(
    function* (input) {
      const tab = yield* requireTab(input.threadId, input.tabId, "input");
      yield* Effect.tryPromise({
        try: async () => {
          if (input.kind === "pointer") {
            await tab.page.mouse.move(input.x, input.y);
            if (input.action === "down") {
              await tab.page.mouse.down({
                button: input.button ?? "left",
                ...(input.clickCount ? { clickCount: input.clickCount } : {}),
              });
            } else if (input.action === "up") {
              await tab.page.mouse.up({
                button: input.button ?? "left",
                ...(input.clickCount ? { clickCount: input.clickCount } : {}),
              });
            }
          } else if (input.kind === "wheel") {
            await tab.page.mouse.move(input.x, input.y);
            await tab.page.mouse.wheel(input.deltaX, input.deltaY);
          } else if (input.action === "down") {
            await tab.page.keyboard.down(input.key);
          } else {
            await tab.page.keyboard.up(input.key);
          }
        },
        catch: (cause) => operationError("input", cause),
      });
    },
  );

  const setViewport: ServerBrowser["Service"]["setViewport"] = Effect.fn(
    "ServerBrowser.setViewport",
  )(function* (input) {
    const resized = yield* resizeIfOpen(input.threadId, input.tabId, input.width, input.height);
    if (!resized) {
      return yield* operationError("resize", "The hosted browser tab is not connected.");
    }
  });

  const history: ServerBrowser["Service"]["history"] = Effect.fn("ServerBrowser.history")(
    function* (input) {
      const tab = yield* requireTab(input.threadId, input.tabId, input.action);
      yield* Effect.tryPromise({
        try: async () => {
          await publishStatus(tab, "Loading");
          if (input.action === "back") await tab.page.goBack({ waitUntil: "domcontentloaded" });
          else await tab.page.goForward({ waitUntil: "domcontentloaded" });
          await publishStatus(tab, "Success");
        },
        catch: (cause) => operationError(input.action, cause),
      });
    },
  );

  const inspect: ServerBrowser["Service"]["inspect"] = Effect.fn("ServerBrowser.inspect")(
    function* (input) {
      const tab = yield* requireTab(input.threadId, input.tabId, "inspect");
      const point = {
        x: Math.min(tab.width - 1, Math.max(0, Math.round(input.x))),
        y: Math.min(tab.height - 1, Math.max(0, Math.round(input.y))),
      };
      return yield* Effect.tryPromise({
        try: () =>
          tab.page.evaluate<PreviewBrowserInspectResult>(
            browserElementsAtPointExpression(point.x, point.y),
          ),
        catch: (cause) => operationError("inspect", cause),
      });
    },
  );

  const automationStatus: ServerBrowser["Service"]["automationStatus"] = Effect.fn(
    "ServerBrowser.automationStatus",
  )(function* (threadId, tabId) {
    const tab = yield* requireTab(threadId, tabId, "automation-tab-not-found");
    return {
      available: !tab.page.isClosed(),
      visible: true,
      tabId: tab.tabId,
      url: tab.page.url() || null,
      title: yield* Effect.tryPromise({
        try: () => tab.page.title(),
        catch: (cause) => operationError("automation-status", cause),
      }),
      loading: yield* Effect.tryPromise({
        try: () => tab.page.evaluate<boolean>("document.readyState !== 'complete'"),
        catch: (cause) => operationError("automation-status", cause),
      }),
      viewport: { width: tab.width, height: tab.height },
    };
  });

  const automationSnapshot: ServerBrowser["Service"]["automationSnapshot"] = Effect.fn(
    "ServerBrowser.automationSnapshot",
  )(function* (threadId, tabId) {
    const tab = yield* requireTab(threadId, tabId, "automation-tab-not-found");
    return yield* Effect.tryPromise({
      try: () => withAutomationAction(tab, "snapshot", () => captureAutomationSnapshot(tab)),
      catch: (cause) => operationError("automation-snapshot", cause),
    });
  });

  const automationClick: ServerBrowser["Service"]["automationClick"] = Effect.fn(
    "ServerBrowser.automationClick",
  )(function* (threadId, tabId, input) {
    const tab = yield* requireTab(threadId, tabId, "automation-tab-not-found");
    yield* Effect.tryPromise({
      try: () =>
        withAutomationAction(tab, "click", async () => {
          const locator = automationLocator(tab, input);
          let point: { readonly x: number; readonly y: number };
          if (locator) {
            const timeout = input.timeoutMs ?? 15_000;
            await locator.waitFor({ state: "visible", timeout });
            await locator.scrollIntoViewIfNeeded({ timeout });
            const box = await locator.boundingBox({ timeout });
            if (!box) throw new Error("The target does not have a visible bounding box.");
            point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          } else {
            const x = input.x!;
            const y = input.y!;
            if (x < 0 || y < 0 || x >= tab.width || y >= tab.height) {
              throw new Error(
                `Coordinates ${x},${y} are outside the ${tab.width}x${tab.height} viewport.`,
              );
            }
            point = { x, y };
          }
          publishCursorFrame(tab, { phase: "move", ...point });
          await tab.page.waitForTimeout(120);
          publishCursorFrame(tab, { phase: "click", ...point });
          if (locator) await locator.click({ timeout: input.timeoutMs ?? 15_000 });
          else await tab.page.mouse.click(point.x, point.y);
          void tab.page
            .waitForTimeout(180)
            .then(() => {
              if (
                tab.cursorPhase === "click" &&
                tab.cursorX === point.x &&
                tab.cursorY === point.y &&
                !tab.page.isClosed()
              ) {
                publishCursorFrame(tab, { phase: "move", ...point });
              }
            })
            .catch(() => undefined);
        }),
      catch: (cause) => selectorOperationError("click", input, cause),
    });
  });

  const automationType: ServerBrowser["Service"]["automationType"] = Effect.fn(
    "ServerBrowser.automationType",
  )(function* (threadId, tabId, input) {
    const tab = yield* requireTab(threadId, tabId, "automation-tab-not-found");
    yield* Effect.tryPromise({
      try: () =>
        withAutomationAction(tab, "type", async () => {
          const locator = automationLocator(tab, input) ?? tab.page.locator(":focus").first();
          if ((await locator.count()) === 0) {
            throw operationError(
              "automation-target-not-editable",
              "No editable target is focused.",
            );
          }
          const editable = await locator.evaluate((element) => {
            const candidate = element as unknown as {
              readonly tagName: string;
              readonly disabled?: boolean;
              readonly readOnly?: boolean;
              readonly type?: string;
              readonly isContentEditable?: boolean;
            };
            if (candidate.tagName === "TEXTAREA") {
              return !candidate.disabled && !candidate.readOnly;
            }
            if (candidate.tagName === "INPUT") {
              return (
                !candidate.disabled &&
                !candidate.readOnly &&
                !new Set([
                  "button",
                  "checkbox",
                  "color",
                  "file",
                  "hidden",
                  "image",
                  "radio",
                  "range",
                  "reset",
                  "submit",
                ]).has(candidate.type ?? "text")
              );
            }
            return candidate.isContentEditable === true;
          });
          if (!editable) {
            throw operationError(
              "automation-target-not-editable",
              "The selected target is not editable.",
            );
          }
          await locator.focus();
          if (input.clear ?? false) await locator.fill("");
          if (input.text.length > 0) await tab.page.keyboard.insertText(input.text);
          await locator.evaluate((element) =>
            element.dispatchEvent(new Event("change", { bubbles: true })),
          );
        }),
      catch: (cause) =>
        isPreviewBrowserOperationError(cause)
          ? cause
          : selectorOperationError("type", input, cause),
    });
  });

  const automationPress: ServerBrowser["Service"]["automationPress"] = Effect.fn(
    "ServerBrowser.automationPress",
  )(function* (threadId, tabId, input) {
    const tab = yield* requireTab(threadId, tabId, "automation-tab-not-found");
    yield* Effect.tryPromise({
      try: () =>
        withAutomationAction(tab, "press", async () => {
          const key = [...(input.modifiers ?? []), input.key].join("+");
          await tab.page.keyboard.press(key);
        }),
      catch: (cause) => operationError("automation-press", cause),
    });
  });

  const automationScroll: ServerBrowser["Service"]["automationScroll"] = Effect.fn(
    "ServerBrowser.automationScroll",
  )(function* (threadId, tabId, input) {
    const tab = yield* requireTab(threadId, tabId, "automation-tab-not-found");
    yield* Effect.tryPromise({
      try: () =>
        withAutomationAction(tab, "scroll", async () => {
          const deltaX = input.deltaX ?? 0;
          const deltaY = input.deltaY ?? 0;
          const locator = automationLocator(tab, input);
          let cursor = { x: tab.cursorX, y: tab.cursorY };
          if (locator) {
            await locator.scrollIntoViewIfNeeded({ timeout: 15_000 });
            const box = await locator.boundingBox({ timeout: 15_000 });
            if (box) cursor = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            publishCursorFrame(tab, { phase: "move", ...cursor });
            await locator.evaluate(
              (element, delta) =>
                element.scrollBy({ left: delta.x, top: delta.y, behavior: "instant" }),
              { x: deltaX, y: deltaY },
            );
          } else {
            publishCursorFrame(tab, { phase: "move", ...cursor });
            await tab.page.evaluate(
              `window.scrollBy({ left: ${JSON.stringify(deltaX)}, top: ${JSON.stringify(deltaY)}, behavior: "instant" })`,
            );
          }
        }),
      catch: (cause) => selectorOperationError("scroll", input, cause),
    });
  });

  const automationEvaluate: ServerBrowser["Service"]["automationEvaluate"] = Effect.fn(
    "ServerBrowser.automationEvaluate",
  )(function* (threadId, tabId, input) {
    const tab = yield* requireTab(threadId, tabId, "automation-tab-not-found");
    return yield* Effect.tryPromise({
      try: () =>
        withAutomationAction(tab, "evaluate", async () => {
          const value = await tab.page.evaluate(input.expression);
          const serialized = JSON.stringify(value);
          const actualBytes = serialized === undefined ? 0 : Buffer.byteLength(serialized, "utf8");
          if (actualBytes > MAX_EVALUATION_BYTES) {
            throw operationError(
              "automation-result-too-large",
              `Evaluation result is ${actualBytes} bytes; maximum is ${MAX_EVALUATION_BYTES}.`,
            );
          }
          return input.returnByValue === false ? null : value;
        }),
      catch: (cause) =>
        isPreviewBrowserOperationError(cause)
          ? cause
          : operationError("automation-evaluate", cause),
    });
  });

  const automationWaitFor: ServerBrowser["Service"]["automationWaitFor"] = Effect.fn(
    "ServerBrowser.automationWaitFor",
  )(function* (threadId, tabId, input) {
    const tab = yield* requireTab(threadId, tabId, "automation-tab-not-found");
    yield* Effect.tryPromise({
      try: () =>
        withAutomationAction(tab, "waitFor", async () => {
          const timeoutMs = input.timeoutMs ?? 15_000;
          const deadline = nowMillis() + timeoutMs;
          const locator = automationLocator(tab, input);
          while (nowMillis() <= deadline) {
            const selectorMatched = locator ? (await locator.count()) > 0 : true;
            const textMatched = input.text
              ? (await tab.page.locator("body").innerText()).includes(input.text)
              : true;
            const urlMatched = input.urlIncludes
              ? tab.page.url().includes(input.urlIncludes)
              : true;
            if (selectorMatched && textMatched && urlMatched) return;
            await tab.page.waitForTimeout(50);
          }
          throw operationError(
            "automation-timeout",
            `Wait conditions did not match within ${timeoutMs}ms.`,
          );
        }),
      catch: (cause) =>
        isPreviewBrowserOperationError(cause)
          ? cause
          : selectorOperationError("wait-for", input, cause),
    });
  });

  const automationRecordingStart: ServerBrowser["Service"]["automationRecordingStart"] = Effect.fn(
    "ServerBrowser.automationRecordingStart",
  )(function* (threadId, tabId) {
    const tab = yield* requireTab(threadId, tabId, "automation-tab-not-found");
    if (activeRecording) {
      if (activeRecording.tab.key === tab.key) {
        return {
          tabId: tab.tabId,
          recording: true,
          startedAt: activeRecording.startedAt,
        };
      }
      return yield* operationError(
        "automation-recording-conflict",
        `Tab ${activeRecording.tab.tabId} is already being recorded.`,
      );
    }
    const recording = yield* Effect.tryPromise({
      try: async () => {
        const id = NodeCrypto.randomUUID();
        const startedAt = nowIso();
        const baseDir =
          process.env["T3CODE_HOME"]?.trim() || NodePath.join(NodeOS.homedir(), ".t3");
        const directory = NodePath.join(baseDir, "artifacts", "browser-recordings");
        await NodeFSP.mkdir(directory, { recursive: true });
        const path = NodePath.join(directory, `${id}.mjpeg`);
        await NodeFSP.writeFile(path, new Uint8Array());
        return {
          id,
          tab,
          path,
          startedAt,
          writePromise: Promise.resolve(),
        } satisfies ActiveRecording;
      },
      catch: (cause) => operationError("automation-recording-start", cause),
    });
    activeRecording = recording;
    if (tab.latestFrameData !== null) appendRecordingFrame(tab, tab.latestFrameData);
    return { tabId: tab.tabId, recording: true, startedAt: recording.startedAt };
  });

  const automationRecordingStop: ServerBrowser["Service"]["automationRecordingStop"] = Effect.fn(
    "ServerBrowser.automationRecordingStop",
  )(function* (tabId) {
    const recording = activeRecording;
    if (!recording || (tabId !== undefined && recording.tab.tabId !== tabId)) {
      return yield* operationError(
        "automation-recording-not-active",
        "No matching recording is active.",
      );
    }
    activeRecording = null;
    return yield* Effect.tryPromise({
      try: async () => {
        await recording.writePromise;
        const stats = await NodeFSP.stat(recording.path);
        return {
          id: recording.id,
          tabId: recording.tab.tabId,
          path: recording.path,
          mimeType: "video/x-motion-jpeg",
          sizeBytes: stats.size,
          createdAt: recording.startedAt,
        };
      },
      catch: (cause) => operationError("automation-recording-stop", cause),
    });
  });
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      if (activeRecording) {
        await activeRecording.writePromise.catch(() => undefined);
        activeRecording = null;
      }
      await Promise.all([...tabs.values()].map((tab) => stopLiveScreencast(tab)));
      const context = await contextPromise?.catch(() => null);
      await context?.close().catch(() => undefined);
      tabs.clear();
    }),
  );

  return ServerBrowser.of({
    ensure,
    frames,
    navigateIfOpen,
    refreshIfOpen,
    resizeIfOpen,
    close,
    sendInput,
    setViewport,
    history,
    inspect,
    automationStatus,
    automationSnapshot,
    automationClick,
    automationType,
    automationPress,
    automationScroll,
    automationEvaluate,
    automationWaitFor,
    automationRecordingStart,
    automationRecordingStop,
    statusEvents: Stream.fromPubSub(statusPubSub),
  });
}).pipe(Effect.withSpan("ServerBrowser.make"));

export const layer = Layer.effect(ServerBrowser, make);
