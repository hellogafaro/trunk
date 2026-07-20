/**
 * In-memory PreviewManager implementation.
 *
 * Sessions are keyed by `(threadId, tabId)`; a single thread can host
 * multiple tabs (browser-style). `open` always creates a new tab — tab
 * lifecycle is owned by the renderer.
 *
 * Events are published via Effect's `PubSub`, so subscriber failures are
 * isolated from the publishing call (a closed WS subscriber queue cannot
 * fail an in-progress `navigate()`).
 */
import {
  type PreviewAutomationClickInput,
  type PreviewAutomationEvaluateInput,
  type PreviewAutomationNavigateInput,
  type PreviewAutomationOpenInput,
  type PreviewAutomationPressInput,
  type PreviewAutomationRequest,
  type PreviewAutomationResizeInput,
  type PreviewAutomationResizeResult,
  type PreviewAutomationScrollInput,
  type PreviewAutomationStatus,
  type PreviewAutomationTypeInput,
  type PreviewAutomationWaitForInput,
  type PreviewBrowserError,
  type PreviewBrowserEvent,
  type PreviewBrowserFramesInput,
  type PreviewBrowserHistoryInput,
  type PreviewBrowserInspectInput,
  type PreviewBrowserInspectResult,
  type PreviewBrowserInput,
  PreviewBrowserOperationError,
  type PreviewBrowserViewportInput,
  type PreviewCloseInput,
  type PreviewEvent,
  type PreviewError,
  PreviewInvalidUrlError,
  type PreviewListInput,
  type PreviewListResult,
  type PreviewNavigateInput,
  type PreviewOpenInput,
  type PreviewRefreshInput,
  type PreviewReportStatusInput,
  type PreviewResizeInput,
  FILL_PREVIEW_VIEWPORT,
  PreviewSessionLookupError,
  type PreviewSessionSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import {
  isPreviewUrlNormalizationError,
  newPreviewTabId,
  normalizePreviewUrl,
} from "@t3tools/shared/preview";
import { resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as ServerBrowser from "./ServerBrowser.ts";

export class PreviewManager extends Context.Service<
  PreviewManager,
  {
    readonly open: (input: PreviewOpenInput) => Effect.Effect<PreviewSessionSnapshot, PreviewError>;
    readonly navigate: (
      input: PreviewNavigateInput,
    ) => Effect.Effect<PreviewSessionSnapshot, PreviewError>;
    readonly reportStatus: (input: PreviewReportStatusInput) => Effect.Effect<void, PreviewError>;
    readonly resize: (
      input: PreviewResizeInput,
    ) => Effect.Effect<PreviewSessionSnapshot, PreviewError>;
    readonly refresh: (input: PreviewRefreshInput) => Effect.Effect<void, PreviewError>;
    readonly close: (input: PreviewCloseInput) => Effect.Effect<void, PreviewError>;
    readonly list: (input: PreviewListInput) => Effect.Effect<PreviewListResult>;
    readonly events: Stream.Stream<PreviewEvent>;
    readonly subscribeEvents: Effect.Effect<PubSub.Subscription<PreviewEvent>, never, Scope.Scope>;
    readonly browserFrames: (
      input: PreviewBrowserFramesInput,
    ) => Effect.Effect<
      Stream.Stream<PreviewBrowserEvent, PreviewBrowserError>,
      PreviewBrowserError
    >;
    readonly sendBrowserInput: (
      input: PreviewBrowserInput,
    ) => Effect.Effect<void, PreviewBrowserError>;
    readonly setBrowserViewport: (
      input: PreviewBrowserViewportInput,
    ) => Effect.Effect<void, PreviewBrowserError>;
    readonly browserHistory: (
      input: PreviewBrowserHistoryInput,
    ) => Effect.Effect<void, PreviewBrowserError>;
    readonly inspectBrowserPoint: (
      input: PreviewBrowserInspectInput,
    ) => Effect.Effect<PreviewBrowserInspectResult, PreviewBrowserError>;
    readonly automate: (
      request: PreviewAutomationRequest,
    ) => Effect.Effect<unknown, PreviewError | PreviewBrowserError>;
  }
>()("t3/preview/Manager/PreviewManager") {}

interface PreviewSessionState {
  readonly threadId: string;
  readonly tabId: string;
  readonly snapshot: PreviewSessionSnapshot;
}

interface ManagerState {
  /** All sessions across every thread, keyed by `${threadId}\u0000${tabId}`. */
  readonly sessions: ReadonlyMap<string, PreviewSessionState>;
}

const initialState: ManagerState = { sessions: new Map() };

const compositeKey = (threadId: string, tabId: string): string => `${threadId}\u0000${tabId}`;

const sessionsForThread = (
  state: ManagerState,
  threadId: string,
): ReadonlyArray<PreviewSessionState> => {
  const out: PreviewSessionState[] = [];
  for (const session of state.sessions.values()) {
    if (session.threadId === threadId) out.push(session);
  }
  return out;
};

const normalizeUrl = (rawUrl: string): Effect.Effect<string, PreviewInvalidUrlError> =>
  Effect.try({
    try: () => normalizePreviewUrl(rawUrl),
    catch: (cause) => {
      if (isPreviewUrlNormalizationError(cause)) {
        return new PreviewInvalidUrlError({
          inputLength: cause.inputLength,
          reason: cause.reason,
          protocol: cause.protocol,
          cause,
        });
      }

      return new PreviewInvalidUrlError({
        inputLength: rawUrl.length,
        reason: "unexpected",
        cause,
      });
    },
  });

const currentIsoTimestamp = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const buildLoadingSnapshot = (input: {
  readonly threadId: string;
  readonly tabId: string;
  readonly url: string;
  readonly title: string;
  readonly updatedAt: string;
}): PreviewSessionSnapshot => ({
  threadId: input.threadId,
  tabId: input.tabId,
  navStatus: { _tag: "Loading", url: input.url, title: input.title },
  canGoBack: false,
  canGoForward: false,
  viewport: FILL_PREVIEW_VIEWPORT,
  updatedAt: input.updatedAt,
});

const buildIdleSnapshot = (input: {
  readonly threadId: string;
  readonly tabId: string;
  readonly updatedAt: string;
}): PreviewSessionSnapshot => ({
  threadId: input.threadId,
  tabId: input.tabId,
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  viewport: FILL_PREVIEW_VIEWPORT,
  updatedAt: input.updatedAt,
});

export const make = Effect.gen(function* PreviewManagerMake() {
  const serverBrowser = yield* ServerBrowser.ServerBrowser;
  const stateRef = yield* SynchronizedRef.make<ManagerState>(initialState);
  // Unbounded PubSub is fine here — events are tiny and we don't want to
  // block publishers if a subscriber is slow. WS clients backpressure on
  // their own queues downstream.
  const eventsPubSub = yield* PubSub.unbounded<PreviewEvent>();
  const events: Stream.Stream<PreviewEvent> = Stream.fromPubSub(eventsPubSub);

  /**
   * Atomic read-modify-write over the session for `(threadId, tabId)`. The
   * mutator runs under the SynchronizedRef so concurrent writers cannot
   * interleave. Lookup failures travel through the modify result so both
   * branches yield the same `[A, S]` shape `modifyEffect` requires.
   *
   * The event is published INSIDE the lock so observers see events in the
   * same order as the underlying state transitions. Publishing an unbounded
   * PubSub is non-blocking, so this is cheap.
   */
  const mutateExistingSession = <R, E>(
    threadId: string,
    tabId: string,
    mutator: (
      session: PreviewSessionState,
    ) => Effect.Effect<{ next: PreviewSessionState; emit: PreviewEvent | null; result: R }, E>,
  ): Effect.Effect<R, E | PreviewSessionLookupError> => {
    type ModifyResult =
      | { kind: "fail"; error: PreviewSessionLookupError }
      | { kind: "ok"; result: R };

    return SynchronizedRef.modifyEffect(stateRef, (state) => {
      const session = state.sessions.get(compositeKey(threadId, tabId));
      if (!session) {
        return Effect.succeed([
          { kind: "fail", error: new PreviewSessionLookupError({ threadId, tabId }) },
          state,
        ] as readonly [ModifyResult, ManagerState]);
      }
      return mutator(session).pipe(
        Effect.flatMap(
          Effect.fn("PreviewManager.commitMutation")(function* ({ next, emit, result }) {
            if (emit) yield* PubSub.publish(eventsPubSub, emit);
            const sessions = new Map(state.sessions);
            sessions.set(compositeKey(threadId, tabId), next);
            return [{ kind: "ok", result } as ModifyResult, { sessions }] as readonly [
              ModifyResult,
              ManagerState,
            ];
          }),
        ),
      );
    }).pipe(
      Effect.flatMap((modify) =>
        modify.kind === "fail" ? Effect.fail(modify.error) : Effect.succeed(modify.result),
      ),
    );
  };

  const lookupBrowserSession = (
    threadId: string,
    tabId: string,
  ): Effect.Effect<PreviewSessionState, PreviewBrowserOperationError> =>
    SynchronizedRef.get(stateRef).pipe(
      Effect.flatMap((state) => {
        const session = state.sessions.get(compositeKey(threadId, tabId));
        return session
          ? Effect.succeed(session)
          : Effect.fail(
              new PreviewBrowserOperationError({
                operation: "lookup",
                message: `Unknown hosted browser session: thread=${threadId}, tab=${tabId}`,
              }),
            );
      }),
    );

  const ignoreHostedBrowserFailure = <A>(
    operation: string,
    effect: Effect.Effect<A, PreviewBrowserOperationError>,
  ): Effect.Effect<void> =>
    effect.pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        Effect.logWarning("Hosted browser operation failed", {
          operation,
          detail: error.message,
        }),
      ),
    );

  const open: PreviewManager["Service"]["open"] = Effect.fn("PreviewManager.open")(
    function* (input) {
      const startedAt = yield* DateTime.now;
      const tabId = newPreviewTabId();
      const updatedAt = yield* currentIsoTimestamp;
      const snapshot = input.url
        ? buildLoadingSnapshot({
            threadId: input.threadId,
            tabId,
            url: yield* normalizeUrl(input.url),
            title: "",
            updatedAt,
          })
        : buildIdleSnapshot({ threadId: input.threadId, tabId, updatedAt });
      yield* SynchronizedRef.update(stateRef, (state) => {
        const sessions = new Map(state.sessions);
        sessions.set(compositeKey(input.threadId, tabId), {
          threadId: input.threadId,
          tabId,
          snapshot,
        });
        return { sessions };
      });
      yield* PubSub.publish(eventsPubSub, {
        type: "opened",
        threadId: input.threadId,
        tabId,
        createdAt: snapshot.updatedAt,
        snapshot,
      });
      const completedAt = yield* DateTime.now;
      yield* Effect.logInfo("preview session opened", {
        threadId: input.threadId,
        tabId,
        durationMs: DateTime.toEpochMillis(completedAt) - DateTime.toEpochMillis(startedAt),
      });
      return snapshot;
    },
  );

  const navigate: PreviewManager["Service"]["navigate"] = Effect.fn("PreviewManager.navigate")(
    function* (input) {
      const url = yield* normalizeUrl(input.url);
      const snapshot = yield* mutateExistingSession(
        input.threadId,
        input.tabId,
        Effect.fn("PreviewManager.navigateSession")(function* (session) {
          const updatedAt = yield* currentIsoTimestamp;
          const previousTitle =
            session.snapshot.navStatus._tag === "Idle" ? "" : session.snapshot.navStatus.title;
          const resolvedTitle = input.resolvedTitle ?? previousTitle;
          const snapshot: PreviewSessionSnapshot = {
            threadId: session.threadId,
            tabId: session.tabId,
            navStatus: { _tag: "Success", url, title: resolvedTitle },
            canGoBack: session.snapshot.canGoBack,
            canGoForward: session.snapshot.canGoForward,
            viewport: session.snapshot.viewport ?? FILL_PREVIEW_VIEWPORT,
            updatedAt,
          };
          return {
            next: { ...session, snapshot },
            emit: {
              type: "navigated",
              threadId: session.threadId,
              tabId: session.tabId,
              createdAt: snapshot.updatedAt,
              snapshot,
            },
            result: snapshot,
          };
        }),
      );
      yield* ignoreHostedBrowserFailure(
        "navigate",
        serverBrowser.navigateIfOpen(input.threadId, input.tabId, url),
      );
      return snapshot;
    },
  );

  const reportStatus: PreviewManager["Service"]["reportStatus"] = Effect.fn(
    "PreviewManager.reportStatus",
  )(function* (input) {
    yield* mutateExistingSession(
      input.threadId,
      input.tabId,
      Effect.fn("PreviewManager.reportSessionStatus")(function* (session) {
        const updatedAt = yield* currentIsoTimestamp;
        const snapshot: PreviewSessionSnapshot = {
          threadId: session.threadId,
          tabId: session.tabId,
          navStatus: input.navStatus,
          canGoBack: input.canGoBack,
          canGoForward: input.canGoForward,
          viewport: session.snapshot.viewport ?? FILL_PREVIEW_VIEWPORT,
          updatedAt,
        };
        const emit: PreviewEvent =
          input.navStatus._tag === "LoadFailed"
            ? {
                type: "failed",
                threadId: session.threadId,
                tabId: session.tabId,
                createdAt: snapshot.updatedAt,
                url: input.navStatus.url,
                title: input.navStatus.title,
                code: input.navStatus.code,
                description: input.navStatus.description,
              }
            : {
                type: "navigated",
                threadId: session.threadId,
                tabId: session.tabId,
                createdAt: snapshot.updatedAt,
                snapshot,
              };
        return {
          next: { ...session, snapshot },
          emit,
          result: undefined as void,
        };
      }),
    );
  });

  yield* serverBrowser.statusEvents.pipe(
    Stream.runForEach((input) =>
      reportStatus(input).pipe(
        Effect.catch((error) =>
          Effect.logDebug("Discarded hosted browser status for a closed preview tab", {
            detail: error.message,
          }),
        ),
      ),
    ),
    Effect.forkScoped,
  );

  const resize: PreviewManager["Service"]["resize"] = Effect.fn("PreviewManager.resize")(
    function* (input) {
      const snapshot = yield* mutateExistingSession(
        input.threadId,
        input.tabId,
        Effect.fn("PreviewManager.resizeSession")(function* (session) {
          const updatedAt = yield* currentIsoTimestamp;
          const snapshot: PreviewSessionSnapshot = {
            ...session.snapshot,
            viewport: input.viewport,
            updatedAt,
          };
          return {
            next: { ...session, snapshot },
            emit: {
              type: "resized",
              threadId: session.threadId,
              tabId: session.tabId,
              createdAt: snapshot.updatedAt,
              snapshot,
            },
            result: snapshot,
          };
        }),
      );
      if (input.viewport._tag !== "fill") {
        yield* ignoreHostedBrowserFailure(
          "resize",
          serverBrowser.resizeIfOpen(
            input.threadId,
            input.tabId,
            input.viewport.width,
            input.viewport.height,
          ),
        );
      }
      return snapshot;
    },
  );

  const refresh: PreviewManager["Service"]["refresh"] = Effect.fn("PreviewManager.refresh")(
    function* (input) {
      // Verify the session exists; the desktop bridge handles the actual reload
      // and will report progress back via `reportStatus`. No event emitted.
      yield* mutateExistingSession(input.threadId, input.tabId, (session) =>
        Effect.succeed({ next: session, emit: null, result: undefined as void }),
      );
      yield* ignoreHostedBrowserFailure(
        "refresh",
        serverBrowser.refreshIfOpen(input.threadId, input.tabId),
      );
    },
  );

  const close: PreviewManager["Service"]["close"] = Effect.fn("PreviewManager.close")(
    function* (input) {
      const createdAt = yield* currentIsoTimestamp;
      const events = yield* SynchronizedRef.modify(stateRef, (state) => {
        const eventsToEmit: PreviewEvent[] = [];
        const sessions = new Map(state.sessions);
        const targets = input.tabId
          ? [state.sessions.get(compositeKey(input.threadId, input.tabId))].filter(
              (entry): entry is PreviewSessionState => entry !== undefined,
            )
          : sessionsForThread(state, input.threadId);
        for (const target of targets) {
          sessions.delete(compositeKey(target.threadId, target.tabId));
          eventsToEmit.push({
            type: "closed",
            threadId: target.threadId,
            tabId: target.tabId,
            createdAt,
          });
        }
        if (eventsToEmit.length === 0) {
          return [eventsToEmit, state] as const;
        }
        return [eventsToEmit, { sessions }] as const;
      });
      yield* Effect.forEach(
        events,
        (event) => serverBrowser.close(ThreadId.make(event.threadId), event.tabId),
        { discard: true },
      );
      if (events.length > 0) {
        yield* Effect.forEach(events, (event) => PubSub.publish(eventsPubSub, event), {
          discard: true,
        });
      }
    },
  );

  const list: PreviewManager["Service"]["list"] = Effect.fn("PreviewManager.list")(
    function* (input) {
      return yield* SynchronizedRef.get(stateRef).pipe(
        Effect.map(
          (state): PreviewListResult => ({
            sessions: sessionsForThread(state, input.threadId)
              .map((s) => s.snapshot)
              .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
          }),
        ),
      );
    },
  );

  const browserFrames: PreviewManager["Service"]["browserFrames"] = Effect.fn(
    "PreviewManager.browserFrames",
  )(function* (input) {
    const session = yield* lookupBrowserSession(input.threadId, input.tabId);
    return yield* serverBrowser.frames(session.snapshot);
  });

  const sendBrowserInput: PreviewManager["Service"]["sendBrowserInput"] = Effect.fn(
    "PreviewManager.sendBrowserInput",
  )(function* (input) {
    yield* lookupBrowserSession(input.threadId, input.tabId);
    yield* serverBrowser.sendInput(input);
  });

  const setBrowserViewport: PreviewManager["Service"]["setBrowserViewport"] = Effect.fn(
    "PreviewManager.setBrowserViewport",
  )(function* (input) {
    yield* lookupBrowserSession(input.threadId, input.tabId);
    yield* serverBrowser.setViewport(input);
  });

  const browserHistory: PreviewManager["Service"]["browserHistory"] = Effect.fn(
    "PreviewManager.browserHistory",
  )(function* (input) {
    yield* lookupBrowserSession(input.threadId, input.tabId);
    yield* serverBrowser.history(input);
  });

  const inspectBrowserPoint: PreviewManager["Service"]["inspectBrowserPoint"] = Effect.fn(
    "PreviewManager.inspectBrowserPoint",
  )(function* (input) {
    yield* lookupBrowserSession(input.threadId, input.tabId);
    return yield* serverBrowser.inspect(input);
  });

  const latestAutomationSession = Effect.fn("PreviewManager.latestAutomationSession")(function* (
    threadId: string,
    requestedTabId?: string,
  ) {
    const state = yield* SynchronizedRef.get(stateRef);
    if (requestedTabId) {
      return state.sessions.get(compositeKey(threadId, requestedTabId)) ?? null;
    }
    return (
      sessionsForThread(state, threadId)
        .toSorted((left, right) => left.snapshot.updatedAt.localeCompare(right.snapshot.updatedAt))
        .at(-1) ?? null
    );
  });

  const automationStatusForSession = Effect.fn("PreviewManager.automationStatusForSession")(
    function* (
      session: PreviewSessionState,
    ): Effect.fn.Return<PreviewAutomationStatus, PreviewBrowserError> {
      yield* serverBrowser.ensure(session.snapshot);
      const status = yield* serverBrowser.automationStatus(
        ThreadId.make(session.threadId),
        session.tabId,
      );
      return {
        ...status,
        viewportSetting: session.snapshot.viewport ?? FILL_PREVIEW_VIEWPORT,
      };
    },
  );

  const requireAutomationSession = Effect.fn("PreviewManager.requireAutomationSession")(function* (
    request: PreviewAutomationRequest,
  ) {
    const session = yield* latestAutomationSession(request.threadId, request.tabId);
    if (session) return session;
    return yield* new PreviewBrowserOperationError({
      operation: "automation-tab-not-found",
      message: request.tabId
        ? `Preview tab ${request.tabId} was not found.`
        : "No active preview tab was found.",
    });
  });

  const automationNavigationUrl = (input: PreviewAutomationNavigateInput): string => {
    const target = input.target;
    if (!target) return input.url!;
    if (target.kind === "url") return target.url;
    const protocol = target.protocol ?? "http";
    const path = target.path?.startsWith("/") ? target.path : `/${target.path ?? ""}`;
    return `${protocol}://127.0.0.1:${target.port}${path}`;
  };

  const presentAutomationSession = Effect.fn("PreviewManager.presentAutomationSession")(function* (
    session: PreviewSessionState,
  ) {
    const createdAt = yield* currentIsoTimestamp;
    yield* PubSub.publish(eventsPubSub, {
      type: "automationPresented",
      threadId: session.threadId,
      tabId: session.tabId,
      createdAt,
    });
  });

  const automate: PreviewManager["Service"]["automate"] = Effect.fn("PreviewManager.automate")(
    function* (request) {
      switch (request.operation) {
        case "status": {
          const session = yield* latestAutomationSession(request.threadId, request.tabId);
          if (!session) {
            return {
              available: true,
              visible: false,
              tabId: null,
              url: null,
              title: null,
              loading: false,
              viewportSetting: FILL_PREVIEW_VIEWPORT,
            } satisfies PreviewAutomationStatus;
          }
          return yield* automationStatusForSession(session);
        }
        case "open": {
          const input = request.input as PreviewAutomationOpenInput;
          const reusable =
            input.reuseExistingTab === false
              ? null
              : yield* latestAutomationSession(request.threadId, request.tabId);
          let snapshot: PreviewSessionSnapshot;
          if (reusable) {
            snapshot = reusable.snapshot;
            if (input.url) {
              snapshot = yield* navigate({
                threadId: request.threadId,
                tabId: reusable.tabId,
                url: input.url,
              });
            }
          } else {
            snapshot = yield* open({
              threadId: request.threadId,
              ...(input.url ? { url: input.url } : {}),
            });
          }
          yield* serverBrowser.ensure(snapshot);
          const session = {
            threadId: snapshot.threadId,
            tabId: snapshot.tabId,
            snapshot,
          } satisfies PreviewSessionState;
          if (input.show !== false) yield* presentAutomationSession(session);
          return yield* automationStatusForSession(session);
        }
        case "navigate": {
          const session = yield* requireAutomationSession(request);
          yield* presentAutomationSession(session);
          yield* serverBrowser.ensure(session.snapshot);
          const input = request.input as PreviewAutomationNavigateInput;
          const snapshot = yield* navigate({
            threadId: request.threadId,
            tabId: session.tabId,
            url: automationNavigationUrl(input),
          });
          return yield* automationStatusForSession({ ...session, snapshot });
        }
        case "resize": {
          const session = yield* requireAutomationSession(request);
          yield* presentAutomationSession(session);
          yield* serverBrowser.ensure(session.snapshot);
          const setting = resolvePreviewViewport(request.input as PreviewAutomationResizeInput);
          yield* resize({
            threadId: request.threadId,
            tabId: session.tabId,
            viewport: setting,
          });
          const viewport =
            setting._tag === "fill"
              ? { width: 1280, height: 800 }
              : { width: setting.width, height: setting.height };
          yield* serverBrowser.setViewport({
            threadId: request.threadId,
            tabId: session.tabId,
            ...viewport,
          });
          return {
            tabId: session.tabId,
            setting,
            viewport,
          } satisfies PreviewAutomationResizeResult;
        }
        case "snapshot": {
          const session = yield* requireAutomationSession(request);
          yield* serverBrowser.ensure(session.snapshot);
          return yield* serverBrowser.automationSnapshot(request.threadId, session.tabId);
        }
        case "click": {
          const session = yield* requireAutomationSession(request);
          yield* presentAutomationSession(session);
          yield* serverBrowser.ensure(session.snapshot);
          yield* serverBrowser.automationClick(
            request.threadId,
            session.tabId,
            request.input as PreviewAutomationClickInput,
          );
          return undefined;
        }
        case "type": {
          const session = yield* requireAutomationSession(request);
          yield* presentAutomationSession(session);
          yield* serverBrowser.ensure(session.snapshot);
          yield* serverBrowser.automationType(
            request.threadId,
            session.tabId,
            request.input as PreviewAutomationTypeInput,
          );
          return undefined;
        }
        case "press": {
          const session = yield* requireAutomationSession(request);
          yield* presentAutomationSession(session);
          yield* serverBrowser.ensure(session.snapshot);
          yield* serverBrowser.automationPress(
            request.threadId,
            session.tabId,
            request.input as PreviewAutomationPressInput,
          );
          return undefined;
        }
        case "scroll": {
          const session = yield* requireAutomationSession(request);
          yield* presentAutomationSession(session);
          yield* serverBrowser.ensure(session.snapshot);
          yield* serverBrowser.automationScroll(
            request.threadId,
            session.tabId,
            request.input as PreviewAutomationScrollInput,
          );
          return undefined;
        }
        case "evaluate": {
          const session = yield* requireAutomationSession(request);
          yield* serverBrowser.ensure(session.snapshot);
          return yield* serverBrowser.automationEvaluate(
            request.threadId,
            session.tabId,
            request.input as PreviewAutomationEvaluateInput,
          );
        }
        case "waitFor": {
          const session = yield* requireAutomationSession(request);
          yield* serverBrowser.ensure(session.snapshot);
          yield* serverBrowser.automationWaitFor(
            request.threadId,
            session.tabId,
            request.input as PreviewAutomationWaitForInput,
          );
          return undefined;
        }
        case "recordingStart": {
          const session = yield* requireAutomationSession(request);
          yield* presentAutomationSession(session);
          yield* serverBrowser.ensure(session.snapshot);
          return yield* serverBrowser.automationRecordingStart(request.threadId, session.tabId);
        }
        case "recordingStop":
          return yield* serverBrowser.automationRecordingStop(
            request.tabIdExplicit ? request.tabId : undefined,
          );
      }
    },
  );

  return PreviewManager.of({
    open,
    navigate,
    reportStatus,
    resize,
    refresh,
    close,
    list,
    events,
    subscribeEvents: PubSub.subscribe(eventsPubSub),
    browserFrames,
    sendBrowserInput,
    setBrowserViewport,
    browserHistory,
    inspectBrowserPoint,
    automate,
  });
}).pipe(Effect.withSpan("PreviewManager.make"));

export const layer = Layer.effect(PreviewManager, make).pipe(Layer.provide(ServerBrowser.layer));
