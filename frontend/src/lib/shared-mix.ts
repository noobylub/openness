import { z } from "zod";
import { steeringVector } from "./contracts";
import type { Selection, Vector } from "./contracts";

const mixEntry = steeringVector.extend({ enabled: z.boolean() });
const mixSchema = z.object({
  v: z.literal(1),
  vectors: z.array(mixEntry).refine(
    (items) => new Set(items.map((item) => item.vector_id)).size === items.length,
  ),
});

export type SharedMix = z.infer<typeof mixSchema>;

export function encodeMix(selections: Selection[]): string | null {
  const parsed = mixSchema.safeParse({ v: 1, vectors: selections });
  return parsed.success ? JSON.stringify(parsed.data) : null;
}

export function decodeMix(value: string): SharedMix | null {
  try {
    const parsed = mixSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function resolveMix(mix: SharedMix, catalog: Vector[]): Selection[] | null {
  const byId = new Map(catalog.map((vector) => [vector.vector_id, vector]));
  if (mix.vectors.some((item) => !byId.has(item.vector_id))) return null;
  return mix.vectors.map((item) => ({
    ...item,
    name: byId.get(item.vector_id)?.name || `Vector ${item.vector_id.slice(0, 6)}`,
  }));
}
