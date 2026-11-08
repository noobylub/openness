import { beforeEach, describe, expect, it, vi } from "vitest";
import { event } from "../test-support";

const api = await import("#lib/server/api");
const { GET } = await import("./route");
const { DELETE } = await import("./[id]/route");
const vector_id = "a".repeat(64);
const vector = {
  vector_id,
  name: null,
  layer_id: 10,
  model: "model",
  hidden_size: 2,
  dtype: "float32",
  size_bytes: 8,
  modified_at: "2026-11-03T00:00:00Z",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("vector routes", () => {
  it("lists extraction vectors and strips unrelated upstream fields", async () => {
    const request = vi.spyOn(api, "connectHTTP").mockResolvedValue({
      model: "model",
      count: 1,
      vectors: [{ ...vector, private_debug: true }],
      private_debug: true,
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      model: "model",
      count: 1,
      vectors: [vector],
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "EXTRACTION", "/vectors", "GET", undefined, undefined,
    );
  });

  it.each([
    { model: "model", count: 1, vectors: [] },
    {
      model: "model",
      count: 1,
      vectors: [{ ...vector, vector_id: "invalid" }],
    },
    { model: "model", count: 1, vectors: [{ ...vector, hidden_size: -1 }] },
    { model: "model", count: 1, vectors: [{ ...vector, name: 7 }] },
    { count: 0, vectors: [] },
  ])("rejects malformed vector metadata: %j", async (payload) => {
    vi.spyOn(api, "connectHTTP").mockResolvedValue(payload);
    expect((await GET()).status).toBe(502);
  });

  it.each(["invalid", "A".repeat(64), "a".repeat(63), "a".repeat(65)])(
    "rejects invalid deletion id %s before calling inference",
    async (id) => {
      const request = vi.spyOn(api, "connectHTTP");
      const response = await DELETE(event(`/api/vectors/${id}`, "DELETE"));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "vector_id must be 64 lowercase hexadecimal characters.",
      });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("deletes from extraction and filters its acknowledgement", async () => {
    const request = vi
      .spyOn(api, "connectHTTP")
      .mockResolvedValue({ deleted: true, vector_id, private_debug: true });
    const response = await DELETE(event(`/api/vectors/${vector_id}`, "DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, vector_id });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "EXTRACTION",
      `/vectors/${vector_id}`,
      "DELETE",
      undefined,
      expect.any(AbortSignal),
    );
  });

  it.each([
    { deleted: false, vector_id },
    { deleted: true, vector_id: "b".repeat(64) },
  ])("rejects an inconsistent deletion acknowledgement", async (payload) => {
    vi.spyOn(api, "connectHTTP").mockResolvedValue(payload);
    expect(
      (await DELETE(event(`/api/vectors/${vector_id}`, "DELETE"))).status,
    ).toBe(502);
  });
});
