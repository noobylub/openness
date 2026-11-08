import { beforeEach, describe, expect, it, vi } from "vitest";
import { event } from "../test-support";

const api = await import("#lib/server/api");
const { POST } = await import("./route");
const input = () => ({
  layers: [10],
  pairs: [{ pair_id: "pair", positive: ["Yes"], negative: ["No"] }],
});
const layer = {
  dir: [1, 2],
  vector_id: "a".repeat(64),
  name: null,
  positive_mean: [2, 3],
  negative_mean: [1, 1],
  positive_count: 1,
  negative_count: 1,
};
const result = () => ({
  pair: {
    model: "model",
    layer_names: { "10": "model.layers.10" },
    layers: { "10": { ...layer } },
  },
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("extraction route", () => {
  it("validates and normalizes input, targets extraction, and filters every response level", async () => {
    const upstream = result();
    const request = vi.spyOn(api, "connectHTTP").mockResolvedValue({
      private_debug: true,
      extra_pair: {},
      pair: {
        ...upstream.pair,
        private_debug: true,
        layer_names: { ...upstream.pair.layer_names, private_debug: true },
        layers: { "10": { ...layer, private_debug: true } },
      },
    });
    const response = await POST(
      event("/api/extract", "POST", {
        ...input(),
        vector_name: " Name ",
        private_debug: true,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(upstream);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "EXTRACTION",
      "/extract-vectors",
      "POST",
      { ...input(), vector_name: "Name" },
      expect.any(AbortSignal),
    );
  });

  it("keeps optional layers and vector name absent when omitted", async () => {
    const request = vi.spyOn(api, "connectHTTP").mockResolvedValue(result());
    expect(
      (await POST(event("/api/extract", "POST", { pairs: input().pairs })))
        .status,
    ).toBe(200);
    expect(request).toHaveBeenCalledWith(
      "EXTRACTION",
      "/extract-vectors",
      "POST",
      { pairs: input().pairs },
      expect.any(AbortSignal),
    );
  });

  it.each([
    ["empty pairs", { pairs: [] }],
    ["too many pairs", { pairs: Array(17).fill(input().pairs[0]) }],
    ["duplicate pair ids", { pairs: [input().pairs[0], input().pairs[0]] }],
    ...["__proto__", "constructor", "prototype", "demo"].map(
      (pair_id): [string, unknown] => [
        "reserved pair id",
        { pairs: [{ ...input().pairs[0], pair_id }] },
      ],
    ),
    [
      "empty positive examples",
      { pairs: [{ ...input().pairs[0], positive: [] }] },
    ],
    [
      "too many negative examples",
      {
        pairs: [
          {
            ...input().pairs[0],
            negative: Array(257).fill("No"),
          },
        ],
      },
    ],
    ["blank examples", { pairs: [{ ...input().pairs[0], negative: [" "] }] }],
    [
      "multibyte context",
      { pairs: [{ ...input().pairs[0], positive: ["\u{1f600}".repeat(500)] }] },
    ],
    ["duplicate layers", { ...input(), layers: [10, 10] }],
    ["empty layers", { ...input(), layers: [] }],
    ["out of range layer", { ...input(), layers: [256] }],
    ["blank vector name", { ...input(), vector_name: " " }],
    [
      "too many total prompts",
      {
        pairs: Array.from({ length: 5 }, (_, index) => ({
          pair_id: `pair-${index}`,
          positive: Array(32).fill("Yes"),
          negative: Array(32).fill("No"),
        })),
      },
    ],
  ])("rejects %s before extraction", async (_label, payload) => {
    const request = vi.spyOn(api, "connectHTTP");
    expect((await POST(event("/api/extract", "POST", payload))).status).toBe(
      400,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { pair: { ...result().pair, layers: {} } },
    { pair: { ...result().pair, layers: { "11": layer } } },
    { pair: { ...result().pair, layer_names: {} } },
    ...[
      { dir: [] },
      { dir: [Infinity, 2] },
      { positive_mean: [1] },
      { vector_id: "invalid" },
      { negative_count: -1 },
      { name: 7 },
    ].map((invalid) => ({
      pair: { ...result().pair, layers: { "10": { ...layer, ...invalid } } },
    })),
  ])("rejects malformed or incomplete extraction results", async (payload) => {
    vi.spyOn(api, "connectHTTP").mockResolvedValue(payload);
    expect((await POST(event("/api/extract", "POST", input()))).status).toBe(
      502,
    );
  });

  it("enforces the extraction body limit", async () => {
    const request = vi.spyOn(api, "connectHTTP");
    expect(
      (
        await POST(
          event("/api/extract", "POST", {
            content: "x".repeat(2 * 1024 * 1024),
          }),
        )
      ).status,
    ).toBe(413);
    expect(request).not.toHaveBeenCalled();
  });
});
