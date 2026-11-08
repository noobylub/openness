import { vi } from "vitest";

for (const name of [
  "EXTRACTION_API_URL",
  "INFERENCE_API_URL",
  "VLLM_API_KEY",
  "DEMO_MODE",
])
  vi.stubEnv(name, "");

export const liveConfig = {
  mode: "live" as const,
  extractionUrl: "https://extraction.example",
  inferenceUrl: "https://inference.example",
  timeoutMs: 1000,
  supportsMessages: false,
};

export function event(path: string, method = "GET", body?: unknown): Request {
  const url = new URL(path, "https://studio.example");
  return new Request(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
