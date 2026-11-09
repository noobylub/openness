import { describe, expect, it } from "vitest";
import {
  CHAT_CONTEXT_LIMIT,
  CHAT_OUTPUT_LIMIT,
  EXTRACTION_EXAMPLE_LIMIT,
  chatInput,
  extractionInput,
} from "./contracts";

const vector = { vector_id: "a".repeat(64), coefficient: 1, layer: 10 };
describe("request contracts", () => {
  it.each([{}, { vectors: [] }])("accepts chat without vectors: %j", (selection) => {
    const parsed = chatInput.parse({
      messages: [{ role: "user", content: "Hello" }],
      ...selection,
    });
    expect(parsed.vectors).toEqual([]);
  });
  it("accepts longer messages and the full output allowance", () => {
    expect(chatInput.safeParse({
      messages: [{ role: "user", content: "x".repeat(24_000) }],
      vectors: [vector],
      max_tokens: CHAT_OUTPUT_LIMIT,
    }).success).toBe(true);
  });
  it("accepts 200 short messages but rejects 201", () => {
    const messages = Array.from({ length: 200 }, () => ({ role: "user", content: "Hi" }));
    expect(chatInput.safeParse({ messages, vectors: [vector] }).success).toBe(true);
    expect(chatInput.safeParse({ messages: [...messages, messages[0]], vectors: [vector] }).success).toBe(false);
  });
  it("reserves output and formatting at the context boundary", () => {
    const remaining = CHAT_CONTEXT_LIMIT - CHAT_OUTPUT_LIMIT - 3 * 24 - 2;
    const payload = {
      messages: [
        { role: "user", content: "x".repeat(14_000) },
        { role: "assistant", content: "x".repeat(remaining - 14_001) },
        { role: "user", content: "x" },
      ],
      vectors: [vector],
      max_tokens: CHAT_OUTPUT_LIMIT,
    };
    expect(chatInput.safeParse(payload).success).toBe(true);
    payload.messages[2].content += "x";
    expect(chatInput.safeParse(payload).success).toBe(false);
  });
  it("keeps extraction's original context allowance", () => {
    expect(extractionInput.safeParse({
      pairs: [{ pair_id: "tone", positive: ["x".repeat(2100)], negative: ["No"] }],
    }).success).toBe(false);
  });
  it("accepts up to 256 examples in each role, subject to the 256 total limit", () => {
    const pair = {
      pair_id: "tone",
      positive: Array(120).fill("Yes"),
      negative: Array(120).fill("No"),
    };
    expect(extractionInput.safeParse({ pairs: [pair] }).success).toBe(true);
    expect(
      extractionInput.safeParse({
        pairs: [{ ...pair, positive: Array(EXTRACTION_EXAMPLE_LIMIT + 1).fill("Yes") }],
      }).success,
    ).toBe(false);
    expect(
      extractionInput.safeParse({
        pairs: [
          {
            ...pair,
            positive: Array(129).fill("Yes"),
            negative: Array(128).fill("No"),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts multiple vectors on distinct layers", () => {
    expect(
      chatInput.safeParse({
        messages: [{ role: "user", content: "Hello" }],
        vectors: [vector, { ...vector, layer: 21 }],
      }).success,
    ).toBe(true);
  });
  it("rejects layer conflicts and oversized context", () => {
    expect(
      chatInput.safeParse({
        messages: [{ role: "user", content: "Hello" }],
        vectors: [vector, vector],
      }).success,
    ).toBe(false);
    expect(
      chatInput.safeParse({
        messages: [
          { role: "user", content: "text".repeat(5000) },
          { role: "assistant", content: "text".repeat(4000) },
          { role: "user", content: "Continue" },
        ],
        vectors: [vector],
      }).success,
    ).toBe(false);
  });
  it("normalizes extraction names and rejects unsafe pair keys", () => {
    const pair = { pair_id: "tone", positive: ["Yes"], negative: ["No"] };
    expect(
      extractionInput.parse({ pairs: [pair], vector_name: " Name " })
        .vector_name,
    ).toBe("Name");
    expect(
      extractionInput.safeParse({ pairs: [{ ...pair, pair_id: "__proto__" }] })
        .success,
    ).toBe(false);
  });
});
