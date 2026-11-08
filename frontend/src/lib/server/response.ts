import { z } from "zod";
import { ApiError } from "./api";

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function failure(error: unknown) {
  if (error instanceof ApiError)
    return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json({ error: error.issues[0]?.message || "Invalid request." }, 400);
  return json(
    { error: "The request could not be completed. Please retry." },
    500,
  );
}

export function upstream<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiError("The model service returned an invalid response.", 502);
  return parsed.data;
}

export async function readBody(
  request: Request,
  limit: number,
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new ApiError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("A JSON body is required.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError("Request is too large.", 413);
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("Request must contain valid UTF-8 JSON.", 400);
  }
}
