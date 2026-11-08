import { z } from "zod";

export const CHAT_CONTEXT_LIMIT = 32_768;
export const CHAT_OUTPUT_LIMIT = 4_096;
export const CHAT_MESSAGE_LIMIT = 24_000;
export const CHAT_MESSAGE_COUNT_LIMIT = 200;
export const CHAT_BODY_LIMIT = 256 * 1024;
export const EXTRACTION_EXAMPLE_LIMIT = 256;

export const vectorId = z.string().regex(/^[a-f0-9]{64}$/);
export const text = z.string().trim().min(1).max(6000);
export const layerIndex = z.number().int().min(0).max(255);
export const steeringVector = z.object({
  vector_id: vectorId,
  coefficient: z.number().finite().min(-100).max(100),
  layer: layerIndex,
});
export const chatInput = z
  .object({
    messages: z
      .array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(CHAT_MESSAGE_LIMIT),
      }))
      .min(1)
      .max(CHAT_MESSAGE_COUNT_LIMIT),
    vectors: z.array(steeringVector).min(1).max(16),
    max_tokens: z.number().int().min(1).max(CHAT_OUTPUT_LIMIT).default(128),
  })
  .refine(
    (value) => value.messages.at(-1)?.role === "user",
    "The last message must be from the user.",
  )
  .refine(
    (value) =>
      new Set(value.vectors.map((vector) => vector.layer)).size ===
      value.vectors.length,
    "Select only one vector per target layer.",
  )
  .refine(
    (value) =>
      contextFits(
        value.messages.map((message) => message.content).join("\n"),
        value.max_tokens,
        value.messages.length * 24,
        CHAT_CONTEXT_LIMIT,
      ),
    "Conversation exceeds the model context budget. Start a new conversation or lower the output length.",
  );

export function contextFits(content: string, output = 1, overhead = 64, limit = 2048) {
  return new TextEncoder().encode(content).length + output + overhead <= limit;
}

export const pairSchema = z.object({
  pair_id: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(
      (value) =>
        !["__proto__", "constructor", "prototype", "demo"].includes(value),
    ),
  positive: z
    .array(text.refine((value) => contextFits(value)))
    .min(1)
    .max(EXTRACTION_EXAMPLE_LIMIT),
  negative: z
    .array(text.refine((value) => contextFits(value)))
    .min(1)
    .max(EXTRACTION_EXAMPLE_LIMIT),
});
export const extractionInput = z
  .object({
    pairs: z.array(pairSchema).min(1).max(16),
    layers: z
      .array(layerIndex)
      .min(1)
      .max(16)
      .refine((value) => new Set(value).size === value.length)
      .optional(),
    vector_name: z.string().trim().min(1).max(120).optional(),
  })
  .refine(
    (value) =>
      new Set(value.pairs.map((pair) => pair.pair_id)).size ===
      value.pairs.length,
    "Pair names must be unique.",
  )
  .refine(
    (value) =>
      value.pairs.reduce(
        (total, pair) => total + pair.positive.length + pair.negative.length,
        0,
      ) <= EXTRACTION_EXAMPLE_LIMIT,
    `Use at most ${EXTRACTION_EXAMPLE_LIMIT} examples per extraction.`,
  );

export const vectorSchema = z.object({
  vector_id: vectorId,
  name: z.string().nullable(),
  layer_id: layerIndex.nullable(),
  model: z.string().min(1),
  hidden_size: z.number().int().positive(),
  dtype: z.string(),
  size_bytes: z.number().int().nonnegative(),
  modified_at: z.string(),
});
export type Vector = z.infer<typeof vectorSchema>;
export type Pair = z.infer<typeof pairSchema>;
export type ExtractionInput = z.infer<typeof extractionInput>;
export type Selection = z.infer<typeof steeringVector> & {
  name: string;
  enabled: boolean;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  vectors?: Selection[];
  model?: string;
};
export type Conversation = {
  id: string;
  title: string;
  updated: number;
  messages: Message[];
  selections: Selection[];
};
