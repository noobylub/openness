import { describe, expect, it } from "vitest";
import { EXTRACTION_EXAMPLE_LIMIT } from "./contracts";
import { parseImport } from "./import";

describe("file import", () => {
  it("parses text lines and keeps the selected role", () => {
      expect(parseImport(" First \\ Second ", "txt", "negative")).toEqual({
      examples: ["First", "Second"],
      role: "negative",
    });
  });
  it("accepts structured pairs", () => {
      expect(parseImport(
        JSON.stringify({
          pairs: [{ pair_id: "tone", positive: ["Yes"], negative: ["No"] }],
          layers: [10],
        }),
        "json",
        "positive",
      ).pairs).toHaveLength(1);
  });
  it("accepts up to 256 text examples and rejects malformed, empty, or oversized lists", () => {
    expect(() => parseImport(" ", "txt", "positive")).toThrow();
    expect(() =>
      parseImport(
        Array(EXTRACTION_EXAMPLE_LIMIT + 1).fill("text").join("\\"),
        "txt",
        "positive",
      ),
    ).toThrow();
    expect(
      parseImport(
        Array(EXTRACTION_EXAMPLE_LIMIT).fill("text").join("\\"),
        "txt",
        "positive",
      ).examples,
    ).toHaveLength(EXTRACTION_EXAMPLE_LIMIT);
    expect(() => parseImport('{"pairs":[]}', "json", "positive")).toThrow();
  });
});
