import { beforeEach, describe, expect, it, vi } from "vitest";
import { event } from "../test-support";

const api = await import("#lib/server/api");
const { POST } = await import("./route");
const input = () => ({
  messages: [
    { role: "user", content: "First" },
    { role: "assistant", content: "Reply" },
    { role: "user", content: "Next" },
  ],
  vectors: [{ vector_id: "a".repeat(64), coefficient: 0.5, layer: 10 }],
  max_tokens: 128,
});
const reply = { model: "model", choices: [{ message: { content: "Answer" } }] };

beforeEach(() => {
  vi.restoreAllMocks();
  api.config.supportsMessages = false;
});

describe("chat route", () => {
  it.each([false, true])("preserves every vector coefficient with supportsMessages=%s", async (supportsMessages) => {
    api.config.supportsMessages = supportsMessages;
    const vectors = [
      { vector_id: "a".repeat(64), coefficient: 2.5, layer: 10 },
      { vector_id: "b".repeat(64), coefficient: -1.75, layer: 11 },
      { vector_id: "c".repeat(64), coefficient: 0, layer: 12 },
    ];
    const request = vi.spyOn(api, "connectHTTP").mockResolvedValue(reply);

    const response = await POST(event("/api/chat", "POST", { ...input(), vectors }));

    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "INFERENCE",
      "/steer",
      "POST",
      expect.objectContaining({ vectors }),
      expect.any(AbortSignal),
    );
  });

  it("defaults to a complete transcript and maps OpenAI content, model and usage", async () => {
    const request = vi.spyOn(api, "connectHTTP").mockResolvedValue({
      ...reply,
      usage: { completion_tokens: 2 },
      private_debug: true,
    });
    const response = await POST(event("/api/chat", "POST", input()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      content: "Answer",
      model: "model",
      usage: { completion_tokens: 2 },
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "INFERENCE",
      "/steer",
      "POST",
      {
        prompt:
          "--- USER ---\nFirst\n\n--- ASSISTANT ---\nReply\n\n--- USER ---\nNext\n\n--- ASSISTANT ---\n",
        vectors: input().vectors,
        max_tokens: 128,
      },
      expect.any(AbortSignal),
    );
  });

  it("only sends native messages when explicitly supported", async () => {
    api.config.supportsMessages = true;
    const request = vi.spyOn(api, "connectHTTP").mockResolvedValue(reply);
    const response = await POST(event("/api/chat", "POST", input()));
    expect(await response.json()).toEqual({
      content: "Answer",
      model: "model",
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "INFERENCE",
      "/steer",
      "POST",
      input(),
      expect.any(AbortSignal),
    );
  });

  it.each([
    ["empty messages", { ...input(), messages: [] }],
    [
      "too many messages",
      {
        ...input(),
        messages: Array.from({ length: 201 }, () => ({
          role: "user",
          content: "Hi",
        })),
      },
    ],
    [
      "system role",
      { ...input(), messages: [{ role: "system", content: "Hi" }] },
    ],
    [
      "assistant ending",
      { ...input(), messages: [{ role: "assistant", content: "Hi" }] },
    ],
    [
      "blank content",
      { ...input(), messages: [{ role: "user", content: " " }] },
    ],
    ["unsteered chat", { ...input(), vectors: [] }],
    [
      "too many vectors",
      { ...input(), vectors: Array(17).fill(input().vectors[0]) },
    ],
    [
      "duplicate layers",
      { ...input(), vectors: [input().vectors[0], input().vectors[0]] },
    ],
    [
      "bad id",
      {
        ...input(),
        vectors: [{ ...input().vectors[0], vector_id: "../invalid" }],
      },
    ],
    [
      "large coefficient",
      { ...input(), vectors: [{ ...input().vectors[0], coefficient: 101 }] },
    ],
    [
      "nonfinite coefficient",
      {
        ...input(),
        vectors: [{ ...input().vectors[0], coefficient: Infinity }],
      },
    ],
    [
      "bad layer",
      { ...input(), vectors: [{ ...input().vectors[0], layer: 256 }] },
    ],
    ["boolean tokens", { ...input(), max_tokens: true }],
    ["output reservation", { ...input(), max_tokens: 4097 }],
    [
      "multibyte context",
      {
        ...input(),
        messages: [{ role: "user", content: "\u{1f600}".repeat(9000) }],
      },
    ],
    ["not an object", []],
  ])("rejects %s without an upstream request", async (_label, payload) => {
    const request = vi.spyOn(api, "connectHTTP");
    expect((await POST(event("/api/chat", "POST", payload))).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { choices: [] },
    { ...reply, model: null },
    { model: "model", choices: [{ message: { content: 3 } }] },
  ])("rejects malformed success payloads", async (payload) => {
    vi.spyOn(api, "connectHTTP").mockResolvedValue(payload);
    expect((await POST(event("/api/chat", "POST", input()))).status).toBe(502);
  });

  it("enforces the chat body limit before contacting inference", async () => {
    const request = vi.spyOn(api, "connectHTTP");
    expect(
      (
        await POST(
          event("/api/chat", "POST", { content: "x".repeat(257 * 1024) }),
        )
      ).status,
    ).toBe(413);
    expect(request).not.toHaveBeenCalled();
  });
});
