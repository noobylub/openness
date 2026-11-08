import { z } from "zod";
import { extractionInput, vectorId } from "@/lib/contracts";
import { ApiError, connectHTTP } from "@/lib/server/api";
import { failure, json, readBody, upstream } from "@/lib/server/response";

export const runtime = "nodejs";
const floats = z.array(z.number().finite()).min(1);
const layerSchema = z
  .object({
    dir: floats,
    vector_id: vectorId,
    name: z.string().nullable(),
    positive_mean: floats,
    negative_mean: floats,
    positive_count: z.number().int().positive(),
    negative_count: z.number().int().positive(),
  })
  .refine(
    (value) =>
      value.dir.length === value.positive_mean.length &&
      value.dir.length === value.negative_mean.length,
  );
const pairResult = z.object({
  model: z.string().min(1),
  layer_names: z.record(z.string(), z.unknown()),
  layers: z.record(z.string(), layerSchema),
});

export async function POST(request: Request) {
  try {
    const input = extractionInput.parse(
      await readBody(request, 2 * 1024 * 1024),
    );
    console.log("Extraction input:", input);
    console.log(
      "Positive examples sent to extraction service:",
      input.pairs.map((pair) => pair.positive),
    );

    const raw = await connectHTTP(
      "EXTRACTION",
      "/extract-vectors",
      "POST",
      input,
      request.signal,
    );
    if (!raw || typeof raw !== "object")
      throw new ApiError("Invalid extraction response.", 502);
    const results: Record<string, unknown> = {};
    for (const pair of input.pairs) {
      const result = upstream(
        pairResult,
        (raw as Record<string, unknown>)[pair.pair_id],
      );
      const keys = Object.keys(result.layers);
      if (
        !keys.length ||
        keys.some(
          (key) =>
            !/^\d+$/.test(key) || typeof result.layer_names[key] !== "string",
        ) ||
        (input.layers &&
          (keys.length !== input.layers.length ||
            input.layers.some((layer) => !keys.includes(String(layer)))))
      ) {
        throw new ApiError(
          "Extraction response is missing requested layers.",
          502,
        );
      }
      results[pair.pair_id] = {
        ...result,
        layer_names: Object.fromEntries(
          keys.map((key) => [key, result.layer_names[key]]),
        ),
      };
    }
    return json(results);
  } catch (error) {
    return failure(error);
  }
}
