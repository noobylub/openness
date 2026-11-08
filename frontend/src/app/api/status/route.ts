export const dynamic = "force-dynamic";

export async function GET() {
  const authenticated = Boolean(process.env.VLLM_API_KEY);
  return Response.json(
    {
      inference: authenticated && Boolean(process.env.INFERENCE_API_URL),
      extraction: authenticated && Boolean(process.env.EXTRACTION_API_URL),
      supportsMessages: process.env.INFERENCE_SUPPORTS_MESSAGES === "true",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
