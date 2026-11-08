import { z } from "zod";
import { vectorId } from "@/lib/contracts";
import { connectHTTP } from "@/lib/server/api";
import { failure, json, upstream } from "@/lib/server/response";

export async function DELETE(request: Request) {
  const id = new URL(request.url).pathname.split("/").pop();
  if (!vectorId.safeParse(id).success)
    return json(
      { error: "vector_id must be 64 lowercase hexadecimal characters." },
      400,
    );
  try {
    const result = upstream(
      z.object({ deleted: z.literal(true), vector_id: z.literal(id!) }),
      await connectHTTP("EXTRACTION", `/vectors/${id}`, "DELETE", undefined, request.signal),
    );
    return json(result);
  } catch (error) {
    return failure(error);
  }
}
