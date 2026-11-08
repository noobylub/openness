import { afterEach, describe, expect, it, vi } from "vitest";
import { vectors } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("vector catalog requests", () => {
  it("sends the catalog request directly", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ vectors: [] }));
    vi.stubGlobal("fetch", fetcher);

    await expect(vectors(true)).resolves.toEqual([]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/vectors");
  });
});
