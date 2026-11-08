import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectHTTP } from "./api";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("INFERENCE_API_URL", "https://inference.example");
  vi.stubEnv("VLLM_API_KEY", "test-key");
  vi.stubEnv("INFERENCE_READINESS_PATH", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("model readiness", () => {
  it("uses the configured path and accepts an empty readiness response", async () => {
    vi.stubEnv("EXTRACTION_API_URL", "https://extraction.example/");
    vi.stubEnv("EXTRACTION_READINESS_PATH", "/custom-health");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ done: true }));
    vi.stubGlobal("fetch", fetcher);
    await expect(connectHTTP("EXTRACTION", "/extract-vectors", "POST", {})).resolves.toEqual({ done: true });
    expect(fetcher.mock.calls[0]).toEqual([
      "https://extraction.example/custom-health",
      expect.objectContaining({ cache: "no-store", headers: { Authorization: "Bearer test-key" } }),
    ]);
  });

  it("waits 30 seconds between probes and sends the POST exactly once", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ result: "done" }));
    vi.stubGlobal("fetch", fetcher);
    const result = connectHTTP("INFERENCE", "/steer", "POST", { prompt: "Hello" });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ result: "done" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://inference.example/health",
      "https://inference.example/health",
      "https://inference.example/steer",
    ]);
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: "POST", body: '{"prompt":"Hello"}' });
  });

  it.each([401, 403, 404, 500, 204])("does not retry readiness status %s", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetcher);
    await expect(connectHTTP("INFERENCE", "/steer", "POST", {})).rejects.toMatchObject({
      status: status >= 400 && status < 500 ? status : 502,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["60", new Date(Date.now() + 60_000).toUTCString()])("honors Retry-After %s", async (retryAfter) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "Retry-After": retryAfter } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal("fetch", fetcher);
    const result = connectHTTP("INFERENCE", "/steer");
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await result;
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("retries network failures and temporary gateway errors", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 504 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal("fetch", fetcher);
    const result = connectHTTP("INFERENCE", "/steer");
    await vi.advanceTimersByTimeAsync(90_000);
    await result;
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("stops after the 15 minute readiness deadline", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const result = expect(connectHTTP("INFERENCE", "/steer", "POST", {}))
      .rejects.toMatchObject({ status: 504, message: "The model is still starting. Please try again shortly." });
    await vi.advanceTimersByTimeAsync(900_000);
    await result;
    expect(fetcher.mock.calls.every(([url]) => url.endsWith("/health"))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares polling without cancelling other callers", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ done: true }));
    vi.stubGlobal("fetch", fetcher);
    const cancelled = expect(connectHTTP("INFERENCE", "/steer", "POST", {}, controller.signal))
      .rejects.toMatchObject({ status: 499 });
    const remaining = connectHTTP("INFERENCE", "/steer", "POST", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    controller.abort();
    await cancelled;
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(remaining).resolves.toEqual({ done: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("stops polling when its last caller disconnects", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const result = expect(connectHTTP("INFERENCE", "/steer", "POST", {}, controller.signal))
      .rejects.toMatchObject({ status: 499 });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry a failed model POST", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(connectHTTP("INFERENCE", "/steer", "POST", {})).rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects missing configuration without probing", async () => {
    vi.stubEnv("VLLM_API_KEY", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(connectHTTP("INFERENCE", "/steer")).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});