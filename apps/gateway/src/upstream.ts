// @effect-diagnostics globalErrorInEffectCatch:off globalFetchInEffect:off globalErrorInEffectFailure:off preferSchemaOverJson:off nodeBuiltinImport:off globalDate:off
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  EnvironmentId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WS_METHODS,
  type OrchestrationProjectShell,
  type ProviderOptionSelection,
  type ServerConfig,
} from "@t3tools/contracts";
import {
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "@t3tools/client-runtime/connection";
import {
  RpcSessionFactory,
  RpcSessionFactoryLayer,
  type WsRpcProtocolClient,
} from "@t3tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as Socket from "effect/unstable/socket/Socket";

import type { GatewayConfig } from "./config.ts";

export interface GatewayModel {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly providerInstanceId: string;
  readonly ownedBy: string;
  readonly createdAt: number;
}

export type GatewayRunEvent =
  | { readonly type: "delta"; readonly delta: string }
  | { readonly type: "terminal"; readonly failure?: string };

const RpcClientLive = RpcSessionFactoryLayer.pipe(
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
);

export const upstreamRuntime = ManagedRuntime.make(RpcClientLive);

const issueWebSocketTicket = (config: GatewayConfig) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${config.trunkServerUrl}/api/auth/websocket-ticket`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.trunkServerToken}`,
        },
      });
      const body = (await response.json()) as {
        readonly ticket?: unknown;
        readonly error?: unknown;
      };
      if (!response.ok || typeof body.ticket !== "string") {
        throw new Error(
          `Trunk websocket-ticket request failed (${response.status}): ${JSON.stringify(body)}`,
        );
      }
      return body.ticket;
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

const connect = (config: GatewayConfig) =>
  Effect.gen(function* () {
    const ticket = yield* issueWebSocketTicket(config);
    const httpUrl = new URL(config.trunkServerUrl);
    const socketUrl = new URL(config.trunkServerUrl);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.pathname = "/ws";
    socketUrl.search = "";
    socketUrl.searchParams.set("wsTicket", ticket);
    const environmentId = EnvironmentId.make("gateway-upstream");
    const target = new PrimaryConnectionTarget({
      environmentId,
      label: "Trunk",
      httpBaseUrl: httpUrl.toString(),
      wsBaseUrl: socketUrl.origin,
    });
    const prepared: PreparedConnection = {
      environmentId,
      label: "Trunk",
      httpBaseUrl: httpUrl.toString(),
      socketUrl: socketUrl.toString(),
      httpAuthorization: {
        _tag: "Bearer",
        token: config.trunkServerToken,
      },
      target,
    };
    const factory = yield* RpcSessionFactory;
    const session = yield* factory.connect(prepared);
    yield* session.ready;
    return session.client;
  });

const withClient = <A, E>(
  config: GatewayConfig,
  use: (client: WsRpcProtocolClient) => Effect.Effect<A, E>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connect(config);
      return yield* use(client);
    }),
  );

const modelsFromConfig = (serverConfig: ServerConfig): ReadonlyArray<GatewayModel> => {
  const createdAt = Math.floor(Date.now() / 1000);
  return serverConfig.providers.flatMap((provider) => {
    if (
      !provider.enabled ||
      !provider.installed ||
      provider.status === "disabled" ||
      provider.availability === "unavailable"
    ) {
      return [];
    }
    return provider.models.map((model) => ({
      id: `${provider.instanceId}/${model.slug}`,
      slug: model.slug,
      name: model.name,
      providerInstanceId: provider.instanceId,
      ownedBy: provider.displayName ?? provider.driver,
      createdAt,
    }));
  });
};

export const listGatewayModels = (config: GatewayConfig) =>
  withClient(config, (client) =>
    client[WS_METHODS.serverGetConfig]({}).pipe(Effect.map(modelsFromConfig)),
  );

const resolveModel = (
  models: ReadonlyArray<GatewayModel>,
  requested: string,
): GatewayModel | undefined => {
  const exact = models.find((model) => model.id === requested);
  if (exact) return exact;
  const slugMatches = models.filter((model) => model.slug === requested);
  return slugMatches.length === 1 ? slugMatches[0] : undefined;
};

export class GatewayModelNotFoundError extends Error {
  readonly _tag = "GatewayModelNotFoundError";
}

const commandId = (label: string) => CommandId.make(`gateway:${label}:${NodeCrypto.randomUUID()}`);
const nowIso = () => new Date().toISOString();

const ensureProject = (
  client: WsRpcProtocolClient,
  serverConfig: ServerConfig,
  cwd: string,
  model: GatewayModel,
) =>
  Effect.gen(function* () {
    const shell = yield* client[ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]({});
    const existing = shell.projects.find((project) => project.workspaceRoot === cwd);
    if (existing) return existing;

    const suffix = NodeCrypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16);
    const projectId = ProjectId.make(`gateway:${suffix}`);
    const createdAt = nowIso();
    const modelSelection = {
      instanceId: ProviderInstanceId.make(model.providerInstanceId),
      model: model.slug,
    };
    yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
      type: "project.create",
      commandId: commandId("project-create"),
      projectId,
      title: "Gateway",
      workspaceRoot: cwd,
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: modelSelection,
      createdAt,
    }).pipe(
      Effect.catch(() =>
        client[ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]({}).pipe(
          Effect.flatMap((nextShell) => {
            const racedProject = nextShell.projects.find((project) => project.id === projectId);
            return racedProject
              ? Effect.void
              : Effect.fail(new Error(`Could not create the Trunk gateway project for '${cwd}'.`));
          }),
        ),
      ),
    );
    return {
      id: projectId,
      title: "Gateway",
      workspaceRoot: cwd,
      defaultModelSelection: modelSelection,
      scripts: [],
      createdAt,
      updatedAt: createdAt,
    } satisfies OrchestrationProjectShell;
  });

const cleanupThread = (client: WsRpcProtocolClient, threadId: ThreadId) =>
  Effect.gen(function* () {
    yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
      type: "thread.session.stop",
      commandId: commandId("session-stop"),
      threadId,
      createdAt: nowIso(),
    }).pipe(Effect.catchCause(() => Effect.void));
    yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
      type: "thread.delete",
      commandId: commandId("thread-delete"),
      threadId,
    }).pipe(Effect.catchCause(() => Effect.void));
  });

export const runGatewayModel = (
  config: GatewayConfig,
  input: {
    readonly runId: string;
    readonly model: string;
    readonly prompt: string;
    readonly options?: ReadonlyArray<ProviderOptionSelection>;
  },
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* connect(config);
      const serverConfig = yield* client[WS_METHODS.serverGetConfig]({});
      const model = resolveModel(modelsFromConfig(serverConfig), input.model);
      if (!model) {
        return yield* Effect.fail(
          new GatewayModelNotFoundError(
            `Model '${input.model}' was not found. Use GET /v1/models for valid model ids.`,
          ),
        );
      }

      const cwd = config.cwd ?? serverConfig.cwd;
      const project = yield* ensureProject(client, serverConfig, cwd, model);
      const threadId = ThreadId.make(`gateway:${input.runId}:${NodeCrypto.randomUUID()}`);
      const messageId = MessageId.make(`gateway:${input.runId}:${NodeCrypto.randomUUID()}`);
      const createdAt = nowIso();
      const modelSelection = {
        instanceId: ProviderInstanceId.make(model.providerInstanceId),
        model: model.slug,
        ...(input.options === undefined ? {} : { options: input.options }),
      };

      yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
        type: "thread.create",
        commandId: commandId("thread-create"),
        threadId,
        projectId: project.id,
        title: "API request",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      });

      const started = yield* Ref.make(false);
      const seenRunning = yield* Ref.make(false);
      const stream = client[ORCHESTRATION_WS_METHODS.subscribeThread]({ threadId }).pipe(
        Stream.mapEffect((item) =>
          Effect.gen(function* () {
            if (item.kind === "snapshot" && !(yield* Ref.get(started))) {
              yield* Ref.set(started, true);
              yield* client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
                type: "thread.turn.start",
                commandId: commandId("turn-start"),
                threadId,
                message: {
                  messageId,
                  role: "user",
                  text: input.prompt,
                  attachments: [],
                },
                modelSelection,
                titleSeed: "API request",
                runtimeMode: "full-access",
                interactionMode: "default",
                createdAt: nowIso(),
              });
              return [] as ReadonlyArray<GatewayRunEvent>;
            }
            if (item.kind !== "event") return [] as ReadonlyArray<GatewayRunEvent>;

            const event = item.event;
            if (
              event.type === "thread.message-sent" &&
              event.payload.role === "assistant" &&
              event.payload.streaming &&
              event.payload.text.length > 0
            ) {
              return [{ type: "delta", delta: event.payload.text }] as const;
            }
            if (event.type !== "thread.session-set") {
              return [] as ReadonlyArray<GatewayRunEvent>;
            }

            const { session } = event.payload;
            if (session.status === "running") {
              yield* Ref.set(seenRunning, true);
              return [] as ReadonlyArray<GatewayRunEvent>;
            }
            if (!(yield* Ref.get(seenRunning))) {
              return [] as ReadonlyArray<GatewayRunEvent>;
            }
            if (session.status === "error" || session.status === "interrupted") {
              return [
                {
                  type: "terminal",
                  failure:
                    session.lastError ??
                    (session.status === "interrupted"
                      ? "The provider turn was interrupted."
                      : "The provider turn failed."),
                },
              ] as const;
            }
            if (session.status === "ready" || session.status === "stopped") {
              return [{ type: "terminal" }] as const;
            }
            return [] as ReadonlyArray<GatewayRunEvent>;
          }),
        ),
        Stream.flatMap(Stream.fromIterable),
        Stream.takeUntil((event) => event.type === "terminal"),
        Stream.ensuring(cleanupThread(client, threadId)),
      );
      return stream;
    }),
  );
