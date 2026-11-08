# Larasati

A Next.js App Router workspace for steering language models. Built with React 19 and TypeScript.

## Development

Install dependencies with `npm install`. Configure the values from `.env.example` in `.env`, then run `npm run dev`.

The conversation workspace is `/`; the extraction workspace is `/extract`.

## Model Services

`INFERENCE_API_URL` points to the service exposing `/steer`. `EXTRACTION_API_URL` points to the service exposing `/extract-vectors` and `/vectors`. The API key remains on the server.

### GPU Cold Starts

Before each upstream request, the server polls that service's readiness endpoint. Set `INFERENCE_READINESS_PATH` and `EXTRACTION_READINESS_PATH` to paths relative to their service URLs; both default to `/health`. These endpoints must exist and return HTTP 200 only when the model is loaded and can accept work, and HTTP 503 while starting. An empty 200 response is sufficient. A generic liveness endpoint is not sufficient. Probes include the server's bearer token and must reach the hosting layer that wakes the GPU.

Readiness probes time out after 10 seconds. Network failures and HTTP 502, 503, and 504 are retried after 30 seconds, or longer when requested by `Retry-After`. Other responses fail immediately. Startup polling stops after 15 minutes. Concurrent callers share one in-progress check per service within each server process; readiness is not cached afterward. Cancelling one caller does not cancel others, and polling stops when all callers disconnect.

Once ready, the actual request is sent once, with its separate 30-minute timeout. Failed model requests are not automatically retried, to avoid duplicate inference or extraction. This does not bypass hosting execution limits; deployments must support the combined startup and processing duration, or use a background-job backend. Readiness is still a point-in-time check: if the service fails afterward, the actual request returns an error rather than being replayed.

The current inference contract accepts a single prompt. Conversation history is serialized into that prompt. Chat allows a 32,768-unit context budget, up to 4,096 output tokens, 24,000 characters per message, 200 messages, and a 256 KiB request body. Context validation conservatively counts UTF-8 bytes plus reserved output tokens and formatting overhead; it is not exact tokenization. The inference deployment must support at least a 32,768-token context (for vLLM, configure a compatible `max_model_len` and model). These frontend allowances do not increase the backend's context capacity. Extraction retains its existing 2,048-unit context budget. Enable `INFERENCE_SUPPORTS_MESSAGES` only after the backend accepts a messages array; serializing history is not equivalent to native chat-template support.

Extraction accepts UTF-8 text files (one example per line) and JSON matching the request schema. Imports are parsed in a Web Worker and previewed in editable fields before submission. The application does not accept uploaded vector binaries or arbitrary server paths.

Conversations are saved in the browser's IndexedDB. Production hosting must support long-lived inference requests; platform-specific execution limits can require a background-job backend. Responses are not streamed by the current services.

Before exposing this workspace publicly, add access control and rate limits at the deployment boundary, and authenticate the extraction endpoint on the model service.

## Verification

- `npm test`
- `npm run typecheck`
- `npm run build`

For production, run `npm run build` followed by `npm start`.