/**
 * Preview - Schemas for the in-app browser preview surface.
 *
 * The server tracks per-thread tab metadata so it survives client reconnects
 * and multi-window. Electron renders tabs through Chromium <webview>; hosted
 * web clients use the server-browser transport declared below.
 *
 * @module Preview
 */
import { Schema } from "effect";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PickedElementPayloadSchema, PreviewAnnotationRectSchema } from "./previewAnnotation.ts";

const Url = TrimmedNonEmptyString.check(Schema.isMaxLength(2048));
const Title = Schema.String.check(Schema.isMaxLength(512));

export const PreviewTabId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type PreviewTabId = typeof PreviewTabId.Type;

export const PREVIEW_VIEWPORT_MIN_DIMENSION = 240;
export const PREVIEW_VIEWPORT_MAX_DIMENSION = 3840;
export const PREVIEW_VIEWPORT_MAX_AREA = 3840 * 2160;

const PreviewViewportDimension = Schema.Int.check(
  Schema.isBetween({
    minimum: PREVIEW_VIEWPORT_MIN_DIMENSION,
    maximum: PREVIEW_VIEWPORT_MAX_DIMENSION,
  }),
);

const viewportAreaFilter = Schema.makeFilter(
  ({ width, height }: { readonly width: number; readonly height: number }) =>
    width * height <= PREVIEW_VIEWPORT_MAX_AREA ||
    `Viewport area must not exceed ${PREVIEW_VIEWPORT_MAX_AREA} pixels.`,
);

export const PreviewViewportSize = Schema.Struct({
  width: PreviewViewportDimension,
  height: PreviewViewportDimension,
}).check(viewportAreaFilter);
export type PreviewViewportSize = typeof PreviewViewportSize.Type;

/**
 * The page's measured viewport can be smaller than the minimum selectable
 * fixed size while fill mode follows a narrow panel. Keep measurement
 * validation separate from the stricter user-selectable size constraints.
 */
export const PreviewRenderedViewportSize = Schema.Struct({
  width: Schema.Int.check(Schema.isGreaterThan(0)),
  height: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type PreviewRenderedViewportSize = typeof PreviewRenderedViewportSize.Type;

export const PREVIEW_VIEWPORT_PRESET_IDS = [
  "iphone-se",
  "iphone-xr",
  "iphone-12-pro",
  "iphone-14-pro-max",
  "pixel-7",
  "samsung-galaxy-s8-plus",
  "samsung-galaxy-s20-ultra",
  "ipad-mini",
  "ipad-air",
  "ipad-pro",
  "surface-pro-7",
  "surface-duo",
  "galaxy-z-fold-5",
  "asus-zenbook-fold",
  "samsung-galaxy-a51-71",
  "nest-hub",
  "nest-hub-max",
] as const;

export const PreviewViewportPresetId = Schema.Literals(PREVIEW_VIEWPORT_PRESET_IDS);
export type PreviewViewportPresetId = typeof PreviewViewportPresetId.Type;

/**
 * Preset IDs shipped before the Chrome-compatible catalog. Existing sessions
 * can still reconnect with these values, but new resize requests only expose
 * PREVIEW_VIEWPORT_PRESET_IDS.
 */
const LEGACY_PREVIEW_VIEWPORT_PRESET_IDS = [
  "desktop-1920x1080",
  "desktop-1440x900",
  "laptop-1366x768",
  "laptop-1280x800",
  "ipad-pro-11",
  "iphone-15-pro",
  "pixel-8",
  "galaxy-s24",
] as const;

const StoredPreviewViewportPresetId = Schema.Literals([
  ...PREVIEW_VIEWPORT_PRESET_IDS,
  ...LEGACY_PREVIEW_VIEWPORT_PRESET_IDS,
]);

export const PreviewViewportSetting = Schema.Union([
  Schema.TaggedStruct("fill", {}),
  Schema.TaggedStruct("freeform", {
    ...PreviewViewportSize.fields,
  }).check(viewportAreaFilter),
  Schema.TaggedStruct("preset", {
    ...PreviewViewportSize.fields,
    presetId: StoredPreviewViewportPresetId,
  }).check(viewportAreaFilter),
]);
export type PreviewViewportSetting = typeof PreviewViewportSetting.Type;

export const FILL_PREVIEW_VIEWPORT = {
  _tag: "fill",
} as const satisfies PreviewViewportSetting;

export const PreviewNavStatus = Schema.Union([
  Schema.TaggedStruct("Idle", {}),
  Schema.TaggedStruct("Loading", {
    url: Url,
    title: Title,
  }),
  Schema.TaggedStruct("Success", {
    url: Url,
    title: Title,
  }),
  Schema.TaggedStruct("LoadFailed", {
    url: Url,
    title: Title,
    code: Schema.Int,
    description: Schema.String,
  }),
]);
export type PreviewNavStatus = typeof PreviewNavStatus.Type;

export const PreviewSessionSnapshot = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  tabId: PreviewTabId,
  navStatus: PreviewNavStatus,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  /** Missing snapshots from older servers are treated as fill-panel mode. */
  viewport: Schema.optional(PreviewViewportSetting),
  updatedAt: Schema.String,
});
export type PreviewSessionSnapshot = typeof PreviewSessionSnapshot.Type;

export const PreviewOpenInput = Schema.Struct({
  threadId: ThreadId,
  /** Omit to create an empty (Idle) tab the user can type into. */
  url: Schema.optional(Url),
});
export type PreviewOpenInput = typeof PreviewOpenInput.Type;

export const PreviewNavigateInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  url: Url,
  resolvedTitle: Schema.optional(Title),
});
export type PreviewNavigateInput = typeof PreviewNavigateInput.Type;

export const PreviewReportStatusInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  navStatus: PreviewNavStatus,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
});
export type PreviewReportStatusInput = typeof PreviewReportStatusInput.Type;

export const PreviewRefreshInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
});
export type PreviewRefreshInput = typeof PreviewRefreshInput.Type;

export const PreviewResizeInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  viewport: PreviewViewportSetting,
});
export type PreviewResizeInput = typeof PreviewResizeInput.Type;

export const PreviewCloseInput = Schema.Struct({
  threadId: ThreadId,
  tabId: Schema.optional(PreviewTabId),
});
export type PreviewCloseInput = typeof PreviewCloseInput.Type;

export const PreviewListInput = Schema.Struct({
  threadId: ThreadId,
});
export type PreviewListInput = typeof PreviewListInput.Type;

export const PreviewListResult = Schema.Struct({
  sessions: Schema.Array(PreviewSessionSnapshot),
});
export type PreviewListResult = typeof PreviewListResult.Type;

export const PreviewBrowserFramesInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
});
export type PreviewBrowserFramesInput = typeof PreviewBrowserFramesInput.Type;

export const PreviewBrowserFrame = Schema.TaggedStruct("Frame", {
  threadId: ThreadId,
  tabId: PreviewTabId,
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  mimeType: Schema.Literal("image/jpeg"),
  data: Schema.String,
  width: Schema.Int.check(Schema.isGreaterThan(0)),
  height: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type PreviewBrowserFrame = typeof PreviewBrowserFrame.Type;

export const PreviewBrowserCursor = Schema.TaggedStruct("Cursor", {
  threadId: ThreadId,
  tabId: PreviewTabId,
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  phase: Schema.Literals(["move", "click"]),
  x: Schema.Number,
  y: Schema.Number,
});
export type PreviewBrowserCursor = typeof PreviewBrowserCursor.Type;

/** Lightweight cursor events never duplicate the latest JPEG frame. */
export const PreviewBrowserEvent = Schema.Union([PreviewBrowserFrame, PreviewBrowserCursor]);
export type PreviewBrowserEvent = typeof PreviewBrowserEvent.Type;

export const PreviewBrowserViewportInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  width: PreviewRenderedViewportSize.fields.width,
  height: PreviewRenderedViewportSize.fields.height,
});
export type PreviewBrowserViewportInput = typeof PreviewBrowserViewportInput.Type;

export const PreviewBrowserInspectInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  x: Schema.Number,
  y: Schema.Number,
});
export type PreviewBrowserInspectInput = typeof PreviewBrowserInspectInput.Type;

export const PreviewBrowserInspectedElement = Schema.Struct({
  element: PickedElementPayloadSchema,
  rect: PreviewAnnotationRectSchema,
});
export type PreviewBrowserInspectedElement = typeof PreviewBrowserInspectedElement.Type;

export const PreviewBrowserInspectResult = Schema.Array(PreviewBrowserInspectedElement);
export type PreviewBrowserInspectResult = typeof PreviewBrowserInspectResult.Type;

const PreviewBrowserPointerButton = Schema.Literals(["left", "middle", "right"]);

const PreviewBrowserPointerInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  kind: Schema.Literal("pointer"),
  action: Schema.Literals(["move", "down", "up"]),
  x: Schema.Number,
  y: Schema.Number,
  button: Schema.optional(PreviewBrowserPointerButton),
  clickCount: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 }))),
});

const PreviewBrowserWheelInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  kind: Schema.Literal("wheel"),
  x: Schema.Number,
  y: Schema.Number,
  deltaX: Schema.Number,
  deltaY: Schema.Number,
});

const PreviewBrowserKeyboardInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  kind: Schema.Literal("keyboard"),
  action: Schema.Literals(["down", "up"]),
  key: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
});

export const PreviewBrowserInput = Schema.Union([
  PreviewBrowserPointerInput,
  PreviewBrowserWheelInput,
  PreviewBrowserKeyboardInput,
]);
export type PreviewBrowserInput = typeof PreviewBrowserInput.Type;

export const PreviewBrowserHistoryInput = Schema.Struct({
  threadId: ThreadId,
  tabId: PreviewTabId,
  action: Schema.Literals(["back", "forward"]),
});
export type PreviewBrowserHistoryInput = typeof PreviewBrowserHistoryInput.Type;

export class PreviewBrowserUnavailableError extends Schema.TaggedErrorClass<PreviewBrowserUnavailableError>()(
  "PreviewBrowserUnavailableError",
  {
    message: Schema.String,
  },
) {}

export class PreviewBrowserOperationError extends Schema.TaggedErrorClass<PreviewBrowserOperationError>()(
  "PreviewBrowserOperationError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export const PreviewBrowserError = Schema.Union([
  PreviewBrowserUnavailableError,
  PreviewBrowserOperationError,
]);
export type PreviewBrowserError = typeof PreviewBrowserError.Type;

const PreviewEventBaseSchema = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  tabId: PreviewTabId,
  createdAt: Schema.String,
});

const PreviewOpenedEvent = Schema.Struct({
  ...PreviewEventBaseSchema.fields,
  type: Schema.Literal("opened"),
  snapshot: PreviewSessionSnapshot,
});

const PreviewNavigatedEvent = Schema.Struct({
  ...PreviewEventBaseSchema.fields,
  type: Schema.Literal("navigated"),
  snapshot: PreviewSessionSnapshot,
});

const PreviewResizedEvent = Schema.Struct({
  ...PreviewEventBaseSchema.fields,
  type: Schema.Literal("resized"),
  snapshot: PreviewSessionSnapshot,
});

const PreviewFailedEvent = Schema.Struct({
  ...PreviewEventBaseSchema.fields,
  type: Schema.Literal("failed"),
  url: Url,
  title: Title,
  code: Schema.Int,
  description: Schema.String,
});

const PreviewClosedEvent = Schema.Struct({
  ...PreviewEventBaseSchema.fields,
  type: Schema.Literal("closed"),
});

const PreviewAutomationPresentedEvent = Schema.Struct({
  ...PreviewEventBaseSchema.fields,
  type: Schema.Literal("automationPresented"),
});

export const PreviewEvent = Schema.Union([
  PreviewOpenedEvent,
  PreviewNavigatedEvent,
  PreviewResizedEvent,
  PreviewFailedEvent,
  PreviewClosedEvent,
  PreviewAutomationPresentedEvent,
]);
export type PreviewEvent = typeof PreviewEvent.Type;

/**
 * A localhost server detected by the port scanner. Used to populate the
 * "Local" recommendations in the empty-state of the preview panel.
 */
export const DiscoveredLocalServer = Schema.Struct({
  host: TrimmedNonEmptyString,
  port: Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThan(65536)),
  url: Url,
  processName: Schema.NullOr(TrimmedNonEmptyString),
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  terminal: Schema.NullOr(
    Schema.Struct({
      threadId: ThreadId,
      terminalId: TrimmedNonEmptyString,
    }),
  ),
});
export type DiscoveredLocalServer = typeof DiscoveredLocalServer.Type;

export const DiscoveredLocalServerList = Schema.Struct({
  servers: Schema.Array(DiscoveredLocalServer),
  scannedAt: Schema.String,
});
export type DiscoveredLocalServerList = typeof DiscoveredLocalServerList.Type;

export class PreviewSessionLookupError extends Schema.TaggedErrorClass<PreviewSessionLookupError>()(
  "PreviewSessionLookupError",
  {
    threadId: Schema.String,
    tabId: Schema.String,
  },
) {
  override get message() {
    return `Unknown preview session: thread=${this.threadId}, tab=${this.tabId}`;
  }
}

export class PreviewInvalidUrlError extends Schema.TaggedErrorClass<PreviewInvalidUrlError>()(
  "PreviewInvalidUrlError",
  {
    inputLength: Schema.Number,
    reason: Schema.Literals(["empty", "parse", "unsupported-protocol", "unexpected"]),
    protocol: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    const protocol = this.protocol === undefined ? "" : `: ${this.protocol}`;
    return `Invalid preview URL (${this.reason}${protocol}; input length ${this.inputLength}).`;
  }
}

export const PreviewError = Schema.Union([PreviewSessionLookupError, PreviewInvalidUrlError]);
export type PreviewError = typeof PreviewError.Type;
