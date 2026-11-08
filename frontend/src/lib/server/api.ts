export const config = {
  supportsMessages: process.env.INFERENCE_SUPPORTS_MESSAGES === "true",
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

type Service = "INFERENCE" | "EXTRACTION";
type ReadinessCheck = {
  controller: AbortController;
  promise: Promise<void>;
  waiters: number;
};

const readinessChecks = new Map<string, ReadinessCheck>();

function abortable<Value>(promise: Promise<Value>, signal: AbortSignal) {
  return new Promise<Value>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function pollReadiness(url: string, key: string, signal: AbortSignal) {
  while (!signal.aborted) {
    console.log("checking health")
    console.log(`Polling readiness for ${url}`);
    let response: Response | undefined;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
    } catch {
      if (signal.aborted) throw signal.reason;
    }
    let delay = 30_000;
    if (response) {
      await response.body?.cancel();
      if (response.status === 200) return;
      if (![502, 503, 504].includes(response.status)) {
        throw new ApiError(
          response.status === 401 || response.status === 403
            ? "The model service rejected the server credentials."
            : "The model readiness endpoint returned an unexpected response. Check the service readiness path.",
          response.status >= 400 && response.status < 500 ? response.status : 502,
        );
      }
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const milliseconds = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(milliseconds)) delay = Math.max(delay, milliseconds);
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await abortable(new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.min(delay, 900_000));
      }), signal);
    } finally {
      clearTimeout(timer);
    }
  }
  throw signal.reason;
}

async function waitUntilReady(
  service: Service,
  base: string,
  key: string,
  signal?: AbortSignal,
) {
  
  if (signal?.aborted) throw new ApiError("The request was cancelled.", 499);
  
  const path = process.env[`${service}_READINESS_PATH`]?.trim() || "/health";
  
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new ApiError("The service readiness path must start with a single slash.", 503);
  }
  const url = `${base.replace(/\/$/, "")}${path}`;
  const identity = JSON.stringify([service, url, key]);
  let check = readinessChecks.get(identity);
  if (!check) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new ApiError(
      "The model is still starting. Please try again shortly.", 504,
    )), 900_000);
    const promise = pollReadiness(url, key, controller.signal).finally(() => {
      clearTimeout(deadline);
      if (readinessChecks.get(identity)?.promise === promise) {
        readinessChecks.delete(identity);
      }
    });
    check = { controller, promise, waiters: 0 };
    readinessChecks.set(identity, check);
  }
  check.waiters += 1;
  try {
    await (signal ? abortable(check.promise, signal) : check.promise);
  } catch (error) {
    if (signal?.aborted) throw new ApiError("The request was cancelled.", 499);
    throw error;
  } finally {
    check.waiters -= 1;
    if (check.waiters === 0) {
      if (readinessChecks.get(identity) === check) readinessChecks.delete(identity);
      check.controller.abort();
    }
  }
}

export async function connectHTTP(
  service: Service,
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const base = process.env[`${service}_API_URL`]?.trim();
  console.log(`Connecting to ${service} service at ${base}${path}`);
  const key = process.env.VLLM_API_KEY;
  if (!base || !key) {
    throw new ApiError(
      `${service === "INFERENCE" ? "Inference" : "Extraction"} is not configured. Set the service URL and VLLM_API_KEY on the server.`,
      503,
    );
  }
  await waitUntilReady(service, base, key, signal);
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.any([
        AbortSignal.timeout(1_800_000),
        ...(signal ? [signal] : []),
      ]),
    });
  } catch {
    if (signal?.aborted) throw new ApiError("The request was cancelled.", 499);
    throw new ApiError(
      "The model service could not be reached. It may be starting up; please retry.",
      504,
    );
  }
  if (!response.ok) {
    throw new ApiError(
      response.status === 401
        ? "The model service rejected the server credentials."
        : response.status === 404
          ? "The requested vector or service route was not found."
          : "The model service could not complete this request.",
      response.status >= 500 ? 502 : response.status,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError("The model service returned an invalid response.", 502);
  }
}
