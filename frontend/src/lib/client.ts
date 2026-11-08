import type { Vector } from "./contracts";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.error || "The request failed. Please retry.");
  return data as T;
}

let cached: Vector[] | undefined;
let pending: Promise<Vector[]> | undefined;
export function vectors(refresh = false): Promise<Vector[]> {
  if (pending) return pending;
  if (!refresh && cached) return Promise.resolve(cached);
  pending = request<{ vectors: Vector[] }>("/api/vectors")
    .then((data) => {
      cached = data.vectors;
      return data.vectors;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export function invalidateVectors() {
  cached = undefined;
}
export function download(data: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
