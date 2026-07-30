import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_USAGE,
  OpenAIRequestError,
  assistantDelta,
  failureFromEvent,
  isTerminal,
  makeChatCompletion,
  makeResponseObject,
  parseChatCompletionsRequest,
  parseResponsesRequest,
} from "./openai.ts";

describe("Responses API compatibility", () => {
  it("normalizes text input, instructions, streaming, and reasoning effort", () => {
    const parsed = parseResponsesRequest({
      model: "codex/gpt-5.4",
      instructions: "Be concise.",
      input: "Say hello.",
      stream: true,
      reasoning: { effort: "high" },
    });

    expect(parsed.model).toBe("codex/gpt-5.4");
    expect(parsed.prompt).toBe("INSTRUCTIONS:\nBe concise.\n\nSay hello.");
    expect(parsed.stream).toBe(true);
    expect(parsed.options).toEqual([{ id: "effort", value: "high" }]);
  });

  it("normalizes message input", () => {
    const parsed = parseResponsesRequest({
      model: "claude/sonnet",
      input: [
        { role: "developer", content: [{ type: "input_text", text: "Be exact." }] },
        { role: "user", content: "Reply with ok." },
      ],
    });

    expect(parsed.prompt).toBe("DEVELOPER:\nBe exact.\n\nUSER:\nReply with ok.");
  });

  it("rejects unsupported tools with an OpenAI-shaped request error", () => {
    expect(() =>
      parseResponsesRequest({
        model: "codex/gpt-5.4",
        input: "hello",
        tools: [{ type: "web_search" }],
      }),
    ).toThrowError(OpenAIRequestError);

    try {
      parseResponsesRequest({
        model: "codex/gpt-5.4",
        input: "hello",
        tools: [{ type: "web_search" }],
      });
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        type: "invalid_request_error",
        param: "tools",
        code: "unsupported_parameter",
      });
    }
  });

  it("builds a completed response object", () => {
    const response = makeResponseObject(
      {
        id: "resp_test",
        messageId: "msg_test",
        createdAt: 1_700_000_000,
        model: "codex/gpt-5.4",
      },
      {},
      "hello",
      EMPTY_USAGE,
      "completed",
    );

    expect(response).toMatchObject({
      id: "resp_test",
      object: "response",
      status: "completed",
      model: "codex/gpt-5.4",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello" }],
        },
      ],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      },
    });
  });
});

describe("Chat Completions API compatibility", () => {
  it("normalizes a standard chat transcript", () => {
    const parsed = parseChatCompletionsRequest({
      model: "claude/sonnet",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: [{ type: "text", text: "Say hello." }] },
      ],
    });

    expect(parsed.prompt).toBe("SYSTEM:\nBe concise.\n\nUSER:\nSay hello.");
    expect(parsed.stream).toBe(false);
  });

  it("builds a standard chat completion", () => {
    const completion = makeChatCompletion(
      "chatcmpl-test",
      1_700_000_000,
      "claude/sonnet",
      "hello",
      EMPTY_USAGE,
    );

    expect(completion).toMatchObject({
      id: "chatcmpl-test",
      object: "chat.completion",
      model: "claude/sonnet",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello" },
          finish_reason: "stop",
        },
      ],
    });
  });
});

describe("normalized Trunk events", () => {
  it("distinguishes deltas, successful completion, and failure", () => {
    expect(assistantDelta({ type: "delta", delta: "hello" })).toBe("hello");
    expect(isTerminal({ type: "terminal" })).toBe(true);
    expect(failureFromEvent({ type: "terminal", failure: "failed" })).toBe("failed");
  });
});
