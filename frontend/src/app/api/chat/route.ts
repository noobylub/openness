import { z } from "zod";
import { CHAT_BODY_LIMIT, chatInput } from "@/lib/contracts";
import { config, connectHTTP } from "@/lib/server/api";
import { failure, json, readBody, upstream } from "@/lib/server/response";

export const runtime = "nodejs";
const replySchema = z.object({
  model: z.string().min(1),
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  try {
    const input = chatInput.parse(await readBody(request, CHAT_BODY_LIMIT));
    const prompt =
      input.messages
        .map(
          (message) =>
            `--- ${message.role.toUpperCase()} ---\n${message.content}`,
        )
        .join("\n\n") + "\n\n--- ASSISTANT ---\n";
    const payload = config.supportsMessages
      ? input
      : { prompt, vectors: input.vectors, max_tokens: input.max_tokens };
    console.log("Payload:", payload);
    const result = upstream(
      replySchema,
      await connectHTTP("INFERENCE", "/steer", "POST", payload, request.signal),
    );
    return json({
      content: result.choices[0].message.content,
      model: result.model,
      ...(result.usage ? { usage: result.usage } : {}),
    });
  } catch (error) {
    return failure(error);
  }
}
