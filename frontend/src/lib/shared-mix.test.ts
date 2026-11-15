import { describe, expect, it } from "vitest";
import { decodeMix, encodeMix, resolveMix } from "./shared-mix";
import type { Selection, Vector } from "./contracts";

const first: Selection = {
  vector_id: "a".repeat(64),
  name: "First",
  coefficient: -2.5,
  layer: 21,
  enabled: true,
};
const second: Selection = {
  vector_id: "b".repeat(64),
  name: "Second",
  coefficient: 0.3,
  layer: 21,
  enabled: false,
};
const catalog: Vector[] = [first, second].map((item) => ({
  vector_id: item.vector_id,
  name: item.name,
  layer_id: 10,
  model: "model",
  hidden_size: 128,
  dtype: "float32",
  size_bytes: 512,
  modified_at: "today",
}));

describe("shared mixes", () => {
  it("round-trips the mix and resolves names from the collection", () => {
    const encoded = encodeMix([first, second]);
    expect(encoded).not.toBeNull();
    const params = new URLSearchParams();
    params.set("mix", encoded!);
    const decoded = decodeMix(new URLSearchParams(params.toString()).get("mix")!);
    expect(decoded).not.toBeNull();
    expect(resolveMix(decoded!, catalog)).toEqual([first, second]);
    expect(encoded).not.toContain("First");
  });

  it("keeps a mix unresolved if any vector is missing", () => {
    const mix = decodeMix(encodeMix([first, second])!);
    expect(resolveMix(mix!, [catalog[0]])).toBeNull();
  });

  it("rejects malformed, unsupported, duplicate, and invalid settings", () => {
    expect(decodeMix("{")).toBeNull();
    expect(decodeMix(JSON.stringify({ v: 2, vectors: [] }))).toBeNull();
    expect(decodeMix(JSON.stringify({ v: 1, vectors: [first, first] }))).toBeNull();
    expect(encodeMix([{ ...first, coefficient: NaN }])).toBeNull();
    expect(decodeMix(JSON.stringify({ v: 1, vectors: [{ ...first, layer: 256 }] }))).toBeNull();
  });
});
