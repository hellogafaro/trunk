// @effect-diagnostics nodeBuiltinImport:off
import {
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
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { BrowserContext, CDPSession, Page } from "playwright-core";

import { browserElementsAtPointExpression } from "./BrowserElementInspection.ts";

type ServerBrowserError = PreviewBrowserUnavailableError | PreviewBrowserOperationError;

interface BrowserTab {
  readonly key: string;
  readonly threadId: ThreadId;
  readonly tabId: string;
  readonly page: Page;
  readonly cdp: CDPSession;
  readonly frames: PubSub.PubSub<PreviewBrowserFrame>;
  width: number;
  height: number;
  sequence: number;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
const tabKey = (threadId: string, tabId: string): string => `${threadId}\u0000${tabId}`;

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
    readonly statusEvents: Stream.Stream<PreviewReportStatusInput>;
  }
>()("t3/preview/ServerBrowser") {}

export const make = Effect.gen(function* ServerBrowserMake() {
  const tabs = new Map<string, BrowserTab>();
  const statusPubSub = yield* PubSub.sliding<PreviewReportStatusInput>({
    capacity: 64,
    replay: 1,
  });
  let contextPromise: Promise<BrowserContext> | null = null;

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

  const publishCapturedFrame = async (tab: BrowserTab): Promise<PreviewBrowserFrame> => {
    const data = await tab.page.screenshot({ type: "jpeg", quality: 72 });
    const frame: PreviewBrowserFrame = {
      threadId: tab.threadId,
      tabId: tab.tabId,
      sequence: tab.sequence++,
      mimeType: "image/jpeg",
      data: Buffer.from(data).toString("base64"),
      width: tab.width,
      height: tab.height,
    };
    PubSub.publishUnsafe(tab.frames, frame);
    return frame;
  };

  const navigatePage = async (tab: BrowserTab, url: string): Promise<void> => {
    await publishStatus(tab, "Loading", undefined, url);
    try {
      await tab.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await publishStatus(tab, "Success");
      await publishCapturedFrame(tab);
    } catch (cause) {
      await publishStatus(tab, "LoadFailed", {
        code: 0,
        description: cause instanceof Error ? cause.message : "Page failed to load.",
      });
      await publishCapturedFrame(tab).catch(() => undefined);
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
            width: viewport.width,
            height: viewport.height,
            sequence: 0,
          };
          tabs.set(key, created);

          page.on("load", () => {
            void publishStatus(created, "Success");
            void page
              .waitForTimeout(75)
              .then(() => publishCapturedFrame(created))
              .catch(() => undefined);
          });
          page.on("close", () => tabs.delete(key));
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
      } else {
        yield* Effect.tryPromise({
          try: () => publishCapturedFrame(tab).then(() => undefined),
          catch: (cause) => operationError("capture", cause),
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
        await publishCapturedFrame(tab);
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
    yield* Effect.tryPromise({
      try: async () => {
        await tab.page.setViewportSize({ width: tab.width, height: tab.height });
        await publishCapturedFrame(tab);
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
      await tab.page.close().catch(() => undefined);
    });

  const frames: ServerBrowser["Service"]["frames"] = Effect.fn("ServerBrowser.frames")(
    function* (snapshot) {
      const tab = yield* ensureTab(snapshot);
      return Stream.fromPubSub(tab.frames);
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
              await tab.page.mouse.down({ button: input.button ?? "left" });
            } else if (input.action === "up") {
              await tab.page.mouse.up({ button: input.button ?? "left" });
            }
          } else if (input.kind === "wheel") {
            await tab.page.mouse.move(input.x, input.y);
            await tab.page.mouse.wheel(input.deltaX, input.deltaY);
          } else if (input.action === "down") {
            await tab.page.keyboard.down(input.key);
          } else {
            await tab.page.keyboard.up(input.key);
          }
          const shouldCapture =
            input.kind === "wheel" ||
            (input.kind === "pointer" && input.action !== "move") ||
            (input.kind === "keyboard" && input.action === "up");
          if (shouldCapture) {
            await tab.page.waitForTimeout(50);
            await publishCapturedFrame(tab);
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
          await publishCapturedFrame(tab);
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
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      const context = await contextPromise?.catch(() => null);
      await context?.close().catch(() => undefined);
      tabs.clear();
    }),
  );

  return ServerBrowser.of({
    frames,
    navigateIfOpen,
    refreshIfOpen,
    resizeIfOpen,
    close,
    sendInput,
    setViewport,
    history,
    inspect,
    statusEvents: Stream.fromPubSub(statusPubSub),
  });
}).pipe(Effect.withSpan("ServerBrowser.make"));

export const layer = Layer.effect(ServerBrowser, make);
