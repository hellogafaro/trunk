import type { ProviderOptionSelection } from "@t3tools/contracts";

import type { GatewayRunEvent } from "./upstream.ts";

export class OpenAIRequestError extends Error {
  readonly status: number;
  readonly type: string;
  readonly param: string | null;
  readonly code: string | null;

  constructor(
    message: string,
    status = 400,
    type = "invalid_request_error",
    param: string | null = null,
    code: string | null = null,
  ) {
    super(message);
    this.status = status;
    this.type = type;
    this.param = param;
    this.code = code;
  }
}

export interface Invocation {
  readonly model: string;
  readonly prompt: string;
  readonly stream: boolean;
  readonly options?: ReadonlyArray<ProviderOptionSelection>;
  readonly source: Record<string, unknown>;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

const objectBody = (body: unknown): Record<string, unknown> => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new OpenAIRequestError("The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
};

const requiredModel = (body: Record<string, unknown>): string => {
  if (typeof body.model !== "string" || body.model.trim().length === 0) {
    throw new OpenAIRequestError(
      "'model' is required and must be a non-empty string.",
      400,
      "invalid_request_error",
      "model",
    );
  }
  return body.model.trim();
};

const partText = (part: unknown, param: string): string => {
  if (typeof part === "string") return part;
  if (typeof part !== "object" || part === null) {
    throw new OpenAIRequestError(
      `Unsupported content in '${param}'.`,
      400,
      "invalid_request_error",
      param,
    );
  }
  const record = part as Record<string, unknown>;
  if (
    (record.type === "input_text" || record.type === "output_text" || record.type === "text") &&
    typeof record.text === "string"
  ) {
    return record.text;
  }
  throw new OpenAIRequestError(
    `Only text content is currently supported in '${param}'.`,
    400,
    "invalid_request_error",
    param,
    "unsupported_content_type",
  );
};

const contentText = (content: unknown, param: string): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => partText(part, param)).join("");
  throw new OpenAIRequestError(
    `'${param}' must contain text.`,
    400,
    "invalid_request_error",
    param,
  );
};

const transcript = (messages: unknown, param: string): string => {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new OpenAIRequestError(
      `'${param}' must be a non-empty array.`,
      400,
      "invalid_request_error",
      param,
    );
  }
  return messages
    .map((item, index) => {
      if (typeof item !== "object" || item === null) {
        throw new OpenAIRequestError(
          `Invalid message at '${param}[${index}]'.`,
          400,
          "invalid_request_error",
          param,
        );
      }
      const message = item as Record<string, unknown>;
      if (message.type !== undefined && message.type !== "message") {
        throw new OpenAIRequestError(
          `Only message input items are currently supported in '${param}'.`,
          400,
          "invalid_request_error",
          param,
          "unsupported_input_type",
        );
      }
      const role = typeof message.role === "string" ? message.role : "user";
      return `${role.toUpperCase()}:\n${contentText(message.content, `${param}[${index}].content`)}`;
    })
    .join("\n\n");
};

const ensureUnsupportedFeaturesAbsent = (
  body: Record<string, unknown>,
  fields: ReadonlyArray<string>,
) => {
  for (const field of fields) {
    const value = body[field];
    const present =
      value !== undefined &&
      value !== null &&
      value !== false &&
      (!Array.isArray(value) || value.length > 0);
    if (present) {
      throw new OpenAIRequestError(
        `'${field}' is not supported by this gateway yet.`,
        400,
        "invalid_request_error",
        field,
        "unsupported_parameter",
      );
    }
  }
};

const reasoningOptions = (
  body: Record<string, unknown>,
): ReadonlyArray<ProviderOptionSelection> | undefined => {
  if (typeof body.reasoning !== "object" || body.reasoning === null) return undefined;
  const effort = (body.reasoning as Record<string, unknown>).effort;
  return typeof effort === "string" && effort.trim().length > 0
    ? [{ id: "effort", value: effort.trim() }]
    : undefined;
};

export const parseResponsesRequest = (unknownBody: unknown): Invocation => {
  const body = objectBody(unknownBody);
  ensureUnsupportedFeaturesAbsent(body, [
    "background",
    "tools",
    "previous_response_id",
    "conversation",
  ]);
  const model = requiredModel(body);
  let prompt: string;
  if (typeof body.input === "string") {
    prompt = body.input;
  } else {
    prompt = transcript(body.input, "input");
  }
  if (typeof body.instructions === "string" && body.instructions.length > 0) {
    prompt = `INSTRUCTIONS:\n${body.instructions}\n\n${prompt}`;
  }
  if (prompt.trim().length === 0) {
    throw new OpenAIRequestError(
      "'input' must not be empty.",
      400,
      "invalid_request_error",
      "input",
    );
  }
  const options = reasoningOptions(body);
  return {
    model,
    prompt,
    stream: body.stream === true,
    ...(options === undefined ? {} : { options }),
    source: body,
  };
};

export const parseChatCompletionsRequest = (unknownBody: unknown): Invocation => {
  const body = objectBody(unknownBody);
  ensureUnsupportedFeaturesAbsent(body, ["tools", "functions", "audio", "prediction"]);
  if (body.n !== undefined && body.n !== 1) {
    throw new OpenAIRequestError(
      "Only 'n: 1' is supported.",
      400,
      "invalid_request_error",
      "n",
      "unsupported_parameter",
    );
  }
  if (body.logprobs === true) {
    throw new OpenAIRequestError(
      "'logprobs' is not supported.",
      400,
      "invalid_request_error",
      "logprobs",
      "unsupported_parameter",
    );
  }
  return {
    model: requiredModel(body),
    prompt: transcript(body.messages, "messages"),
    stream: body.stream === true,
    source: body,
  };
};

export const assistantDelta = (event: GatewayRunEvent): string | undefined =>
  event.type === "delta" ? event.delta : undefined;

export const usageFromEvent = (_event: GatewayRunEvent, previous: Usage): Usage => previous;

export const failureFromEvent = (event: GatewayRunEvent): string | undefined =>
  event.type === "terminal" ? event.failure : undefined;

export const isTerminal = (event: GatewayRunEvent): boolean => event.type === "terminal";

const responseUsage = (usage: Usage) => ({
  input_tokens: usage.inputTokens,
  input_tokens_details: { cached_tokens: usage.cachedInputTokens },
  output_tokens: usage.outputTokens,
  output_tokens_details: { reasoning_tokens: usage.reasoningTokens },
  total_tokens: usage.totalTokens,
});

export interface ResponseIdentity {
  readonly id: string;
  readonly messageId: string;
  readonly createdAt: number;
  readonly model: string;
}

export const makeResponseObject = (
  identity: ResponseIdentity,
  source: Record<string, unknown>,
  text: string,
  usage: Usage,
  status: "in_progress" | "completed" | "failed",
  failure?: string,
) => ({
  id: identity.id,
  object: "response",
  created_at: identity.createdAt,
  status,
  background: false,
  error: failure
    ? {
        code: "provider_error",
        message: failure,
      }
    : null,
  incomplete_details: null,
  instructions: source.instructions ?? null,
  max_output_tokens: source.max_output_tokens ?? null,
  max_tool_calls: source.max_tool_calls ?? null,
  model: identity.model,
  output:
    status === "in_progress"
      ? []
      : [
          {
            id: identity.messageId,
            type: "message",
            status: status === "completed" ? "completed" : "incomplete",
            role: "assistant",
            content: [
              {
                type: "output_text",
                annotations: [],
                logprobs: [],
                text,
              },
            ],
          },
        ],
  parallel_tool_calls: source.parallel_tool_calls ?? true,
  previous_response_id: null,
  prompt_cache_key: source.prompt_cache_key ?? null,
  reasoning: source.reasoning ?? { effort: null, summary: null },
  safety_identifier: source.safety_identifier ?? null,
  service_tier: source.service_tier ?? "default",
  store: source.store ?? true,
  temperature: source.temperature ?? 1,
  text: source.text ?? { format: { type: "text" } },
  tool_choice: source.tool_choice ?? "auto",
  tools: [],
  top_logprobs: source.top_logprobs ?? 0,
  top_p: source.top_p ?? 1,
  truncation: source.truncation ?? "disabled",
  usage: status === "in_progress" ? null : responseUsage(usage),
  metadata: source.metadata ?? {},
});

export const makeChatCompletion = (
  id: string,
  createdAt: number,
  model: string,
  text: string,
  usage: Usage,
) => ({
  id,
  object: "chat.completion",
  created: createdAt,
  model,
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: text,
        refusal: null,
        annotations: [],
      },
      logprobs: null,
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedInputTokens, audio_tokens: 0 },
    completion_tokens_details: {
      reasoning_tokens: usage.reasoningTokens,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  },
  service_tier: "default",
  system_fingerprint: null,
});

export const openAIErrorBody = (error: unknown) => {
  const requestError =
    error instanceof OpenAIRequestError
      ? error
      : new OpenAIRequestError(
          error instanceof Error ? error.message : String(error),
          500,
          "server_error",
          null,
          "gateway_error",
        );
  return {
    status: requestError.status,
    body: {
      error: {
        message: requestError.message,
        type: requestError.type,
        param: requestError.param,
        code: requestError.code,
      },
    },
  };
};
