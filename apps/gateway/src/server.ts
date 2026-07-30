// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import type { GatewayConfig } from "./config.ts";
import {
  EMPTY_USAGE,
  OpenAIRequestError,
  assistantDelta,
  failureFromEvent,
  isTerminal,
  makeChatCompletion,
  makeResponseObject,
  openAIErrorBody,
  parseChatCompletionsRequest,
  parseResponsesRequest,
  usageFromEvent,
  type Invocation,
  type ResponseIdentity,
  type Usage,
} from "./openai.ts";
import { listGatewayModels, runGatewayModel, upstreamRuntime } from "./upstream.ts";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, content-type, openai-organization, openai-project",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const json = (
  response: NodeHttp.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
) => {
  response.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  response.end(JSON.stringify(body));
};

const readJson = async (request: NodeHttp.IncomingMessage): Promise<unknown> => {
  const chunks: Array<Buffer> = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new OpenAIRequestError(
        `Request body exceeds ${MAX_BODY_BYTES} bytes.`,
        413,
        "invalid_request_error",
        null,
        "request_too_large",
      );
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new OpenAIRequestError(
      "The request body is not valid JSON.",
      400,
      "invalid_request_error",
      null,
      "invalid_json",
    );
  }
};

const secureEqual = (left: string, right: string): boolean => {
  const leftHash = NodeCrypto.createHash("sha256").update(left).digest();
  const rightHash = NodeCrypto.createHash("sha256").update(right).digest();
  return NodeCrypto.timingSafeEqual(leftHash, rightHash);
};

const authenticate = (request: NodeHttp.IncomingMessage, config: GatewayConfig) => {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || !secureEqual(token, config.apiKey)) {
    throw new OpenAIRequestError(
      "Incorrect API key provided.",
      401,
      "authentication_error",
      null,
      "invalid_api_key",
    );
  }
};

interface GenerationResult {
  readonly text: string;
  readonly usage: Usage;
  readonly failure?: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Trunk provider request failed.";

const collectGeneration = (config: GatewayConfig, invocation: Invocation, runId: string) =>
  runGatewayModel(config, {
    runId,
    model: invocation.model,
    prompt: invocation.prompt,
    ...(invocation.options === undefined ? {} : { options: invocation.options }),
  }).pipe(
    Stream.runFold(
      () => ({ text: "", usage: EMPTY_USAGE }) as GenerationResult,
      (state, event): GenerationResult => {
        const delta = assistantDelta(event);
        const failure = failureFromEvent(event) ?? state.failure;
        return {
          text: state.text + (delta ?? ""),
          usage: usageFromEvent(event, state.usage),
          ...(failure === undefined ? {} : { failure }),
        };
      },
    ),
  );

const responseIdentity = (model: string): ResponseIdentity => ({
  id: `resp_${NodeCrypto.randomUUID().replaceAll("-", "")}`,
  messageId: `msg_${NodeCrypto.randomUUID().replaceAll("-", "")}`,
  createdAt: Math.floor(Date.now() / 1000),
  model,
});

const writeResponsesSse = async (
  response: NodeHttp.ServerResponse,
  config: GatewayConfig,
  invocation: Invocation,
  requestId: string,
) => {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": requestId,
    "access-control-allow-origin": "*",
  });

  const identity = responseIdentity(invocation.model);
  let sequence = 0;
  let text = "";
  let usage = EMPTY_USAGE;
  let failure: string | undefined;
  let terminal = false;
  const item = (status: "in_progress" | "completed" | "incomplete", value: string) => ({
    id: identity.messageId,
    type: "message",
    status,
    role: "assistant",
    content: [
      {
        type: "output_text",
        annotations: [],
        logprobs: [],
        text: value,
      },
    ],
  });
  const writeEvent = (type: string, payload: Record<string, unknown>) => {
    response.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...payload })}\n\n`,
    );
  };

  writeEvent("response.created", {
    response: makeResponseObject(identity, invocation.source, "", usage, "in_progress"),
  });
  writeEvent("response.in_progress", {
    response: makeResponseObject(identity, invocation.source, "", usage, "in_progress"),
  });
  writeEvent("response.output_item.added", {
    output_index: 0,
    item: item("in_progress", ""),
  });
  writeEvent("response.content_part.added", {
    item_id: identity.messageId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", annotations: [], logprobs: [], text: "" },
  });

  const run = runGatewayModel(config, {
    runId: requestId,
    model: invocation.model,
    prompt: invocation.prompt,
    ...(invocation.options === undefined ? {} : { options: invocation.options }),
  }).pipe(
    Stream.runForEach((event) =>
      Effect.sync(() => {
        usage = usageFromEvent(event, usage);
        failure = failureFromEvent(event) ?? failure;
        const delta = assistantDelta(event);
        if (delta !== undefined && delta.length > 0) {
          text += delta;
          writeEvent("response.output_text.delta", {
            item_id: identity.messageId,
            output_index: 0,
            content_index: 0,
            delta,
            logprobs: [],
          });
        }
        terminal ||= isTerminal(event);
      }),
    ),
    Effect.scoped,
  );
  const fiber = upstreamRuntime.runFork(run);
  response.once("close", () => {
    if (!response.writableEnded) {
      Effect.runFork(Fiber.interrupt(fiber));
    }
  });
  try {
    await upstreamRuntime.runPromise(Fiber.join(fiber));
  } catch (error) {
    failure = errorMessage(error);
  }

  if (!terminal && failure === undefined) {
    failure = "The provider stream ended before the turn completed.";
  }
  if (response.destroyed) return;
  if (failure !== undefined) {
    writeEvent("response.failed", {
      response: makeResponseObject(identity, invocation.source, text, usage, "failed", failure),
    });
    response.end();
    return;
  }

  writeEvent("response.output_text.done", {
    item_id: identity.messageId,
    output_index: 0,
    content_index: 0,
    text,
    logprobs: [],
  });
  writeEvent("response.content_part.done", {
    item_id: identity.messageId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", annotations: [], logprobs: [], text },
  });
  writeEvent("response.output_item.done", {
    output_index: 0,
    item: item("completed", text),
  });
  writeEvent("response.completed", {
    response: makeResponseObject(identity, invocation.source, text, usage, "completed"),
  });
  response.end();
};

const writeChatSse = async (
  response: NodeHttp.ServerResponse,
  config: GatewayConfig,
  invocation: Invocation,
  requestId: string,
) => {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": requestId,
    "access-control-allow-origin": "*",
  });
  const id = `chatcmpl-${NodeCrypto.randomUUID().replaceAll("-", "")}`;
  const created = Math.floor(Date.now() / 1000);
  let usage = EMPTY_USAGE;
  let failure: string | undefined;
  const chunk = (delta: Record<string, unknown>, finishReason: string | null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model: invocation.model,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
    service_tier: "default",
    system_fingerprint: null,
  });
  const writeData = (value: unknown) => response.write(`data: ${JSON.stringify(value)}\n\n`);
  writeData(chunk({ role: "assistant", content: "" }, null));

  const run = runGatewayModel(config, {
    runId: requestId,
    model: invocation.model,
    prompt: invocation.prompt,
  }).pipe(
    Stream.runForEach((event) =>
      Effect.sync(() => {
        usage = usageFromEvent(event, usage);
        failure = failureFromEvent(event) ?? failure;
        const delta = assistantDelta(event);
        if (delta !== undefined && delta.length > 0) {
          writeData(chunk({ content: delta }, null));
        }
      }),
    ),
    Effect.scoped,
  );
  const fiber = upstreamRuntime.runFork(run);
  response.once("close", () => {
    if (!response.writableEnded) Effect.runFork(Fiber.interrupt(fiber));
  });
  try {
    await upstreamRuntime.runPromise(Fiber.join(fiber));
  } catch (error) {
    failure = errorMessage(error);
  }

  if (response.destroyed) return;
  if (failure !== undefined) {
    writeData({
      error: {
        message: failure,
        type: "server_error",
        param: null,
        code: "provider_error",
      },
    });
    response.write("data: [DONE]\n\n");
    response.end();
    return;
  }
  writeData(chunk({}, "stop"));
  const streamOptions = invocation.source.stream_options;
  if (
    typeof streamOptions === "object" &&
    streamOptions !== null &&
    (streamOptions as Record<string, unknown>).include_usage === true
  ) {
    const completed = makeChatCompletion(id, created, invocation.model, "", usage);
    writeData({ ...completed, object: "chat.completion.chunk", choices: [] });
  }
  response.write("data: [DONE]\n\n");
  response.end();
};

const handleModels = async (
  response: NodeHttp.ServerResponse,
  config: GatewayConfig,
  requestedId?: string,
) => {
  const models = await upstreamRuntime.runPromise(listGatewayModels(config));
  const data = models.map((model) => ({
    id: model.id,
    object: "model",
    created: model.createdAt,
    owned_by: model.ownedBy,
  }));
  if (requestedId !== undefined) {
    const model = data.find(
      (candidate) =>
        candidate.id === requestedId ||
        (models.filter((item) => item.slug === requestedId).length === 1 &&
          models.find((item) => item.slug === requestedId)?.id === candidate.id),
    );
    if (!model) {
      throw new OpenAIRequestError(
        `The model '${requestedId}' does not exist or you do not have access to it.`,
        404,
        "invalid_request_error",
        "model",
        "model_not_found",
      );
    }
    json(response, 200, model);
    return;
  }
  json(response, 200, { object: "list", data, has_more: false });
};

const ensureModelAvailable = async (config: GatewayConfig, requestedId: string) => {
  const models = await upstreamRuntime.runPromise(listGatewayModels(config));
  const exact = models.some((model) => model.id === requestedId);
  const uniqueSlug = models.filter((model) => model.slug === requestedId).length === 1;
  if (!exact && !uniqueSlug) {
    throw new OpenAIRequestError(
      `The model '${requestedId}' does not exist or you do not have access to it.`,
      404,
      "invalid_request_error",
      "model",
      "model_not_found",
    );
  }
};

const handleRequest = async (
  request: NodeHttp.IncomingMessage,
  response: NodeHttp.ServerResponse,
  config: GatewayConfig,
) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, JSON_HEADERS);
    response.end();
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, { status: "ok" });
    return;
  }

  authenticate(request, config);
  const requestId = NodeCrypto.randomUUID();
  if (request.method === "GET" && url.pathname === "/v1/models") {
    await handleModels(response, config);
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/v1/models/")) {
    await handleModels(response, config, decodeURIComponent(url.pathname.slice(11)));
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/responses") {
    const invocation = parseResponsesRequest(await readJson(request));
    await ensureModelAvailable(config, invocation.model);
    if (invocation.stream) {
      await writeResponsesSse(response, config, invocation, requestId);
      return;
    }
    const result = await upstreamRuntime.runPromise(
      collectGeneration(config, invocation, requestId),
    );
    if (result.failure !== undefined) {
      throw new OpenAIRequestError(result.failure, 502, "server_error", null, "provider_error");
    }
    json(
      response,
      200,
      makeResponseObject(
        responseIdentity(invocation.model),
        invocation.source,
        result.text,
        result.usage,
        "completed",
      ),
      { "x-request-id": requestId },
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    const invocation = parseChatCompletionsRequest(await readJson(request));
    await ensureModelAvailable(config, invocation.model);
    if (invocation.stream) {
      await writeChatSse(response, config, invocation, requestId);
      return;
    }
    const result = await upstreamRuntime.runPromise(
      collectGeneration(config, invocation, requestId),
    );
    if (result.failure !== undefined) {
      throw new OpenAIRequestError(result.failure, 502, "server_error", null, "provider_error");
    }
    json(
      response,
      200,
      makeChatCompletion(
        `chatcmpl-${NodeCrypto.randomUUID().replaceAll("-", "")}`,
        Math.floor(Date.now() / 1000),
        invocation.model,
        result.text,
        result.usage,
      ),
      { "x-request-id": requestId },
    );
    return;
  }

  throw new OpenAIRequestError(
    `Unknown endpoint: ${request.method ?? "GET"} ${url.pathname}`,
    404,
    "invalid_request_error",
    null,
    "not_found",
  );
};

export const startGatewayServer = (config: GatewayConfig) => {
  const server = NodeHttp.createServer((request, response) => {
    void handleRequest(request, response, config).catch((error) => {
      if (response.headersSent) {
        if (!response.writableEnded) response.end();
        console.error("Gateway streaming request failed", error);
        return;
      }
      const formatted = openAIErrorBody(error);
      json(response, formatted.status, formatted.body);
    });
  });
  server.listen(config.port, config.host, () => {
    console.log(`Trunk Gateway listening on http://${config.host}:${config.port}/v1`);
  });
  return server;
};
