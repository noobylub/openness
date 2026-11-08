import { z } from "zod";
import { vectorSchema } from "@/lib/contracts";
import { connectHTTP } from "@/lib/server/api";
import { failure, json, upstream } from "@/lib/server/response";

export const dynamic = "force-dynamic";
const catalog = z
  .object({
    model: z.string().min(1),
    count: z.number().int().nonnegative(),
    vectors: z.array(vectorSchema),
  })
  .refine((value) => value.count === value.vectors.length);

export async function GET(request?: Request) {
  try {
    const data = json(upstream(catalog, await connectHTTP(
      "INFERENCE", "/vectors", "GET", undefined, request?.signal,
    )));
    console.log(data);
    return data;

  } catch (error) {
    return failure(error);
  }
  
}
