# Mechanistic Interpretability Services

This repository builds two independent RunPod Serverless images from one codebase. The builder creates steering vectors; the inference service loads them and generates text. Your database is the persistence bridge between workers. They do not share a filesystem, process, memory, or GPU.

**Builder image != inference image.** They are separate images and separate deployments built from the same Git repository. They can be published as separate tags in one Docker Hub repository.

Probe creation is intentionally deferred. The inference request schema recognizes probe configurations, but requests using a probe currently return HTTP 501 until the probe implementation is integrated. The probe-only and combined examples below document the intended API shape, not an available algorithm today.

## Architecture and layout

```text
backend/
├── src/
│   ├── common/          # model loading interface, database adapter boundary, worker-local cache
│   ├── builder/         # RunPod queue entry point; create_steering only
│   ├── inference/       # FastAPI app; /ping and /generate
│   ├── algorithms/      # steering extraction and hook-based generation algorithms
│   └── generation/      # generation dispatcher
├── docker/
│   ├── Dockerfile.builder
│   └── Dockerfile.inference
├── requirements/
│   ├── requirements-builder.txt
│   ├── requirements-inference.txt
│   ├── requirements-test.txt
│   └── requirements.txt # legacy combined dependencies
└── tests/
```

The steering extraction and generation algorithms now live canonically in `src/algorithms/`; service code imports them directly with no forwarding package. The builder loads one model per worker at startup, extracts the requested layer, writes the tensor and metadata through `DatabaseArtifactStore`, and returns metadata only. Inference independently loads its own model once during FastAPI lifespan startup and loads vectors from the database on cache misses. Its bounded cache is local to that worker. A per-worker async lock serializes model generation because interventions use hooks on a shared model.

## Configuration

Set these environment variables on **both** deployments:

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `MODEL_NAME` | yes | none | Hugging Face model ID or mounted model path, for example `Qwen/Qwen3-8B`. Legacy `MODEL_ID` remains accepted. |
| `TORCH_DTYPE` | no | `bfloat16` | `bfloat16`, `float16`, or `float32`. |
| `PORT` | no | `80` | Inference HTTP port. |
| `HF_TOKEN` | gated/private models | none | Hugging Face access token, configured as a deployment secret. |

Database integration is not wired to a specific client or schema yet. Implement `DatabaseArtifactStore.save_artifact()` and `DatabaseArtifactStore.load_artifact()` in `src/common/artifacts.py`; both services already use this shared boundary. The tensor helpers encode vectors as safetensors bytes and metadata as JSON. Keep DB-specific queries and credentials in that adapter, not in either service handler. The inference cache remains process-local and is only an optimization, not permanent storage.

## Local testing

From this `backend/` directory, configure model access. Database configuration should be added to the adapter when you integrate your database client:

```bash
export MODEL_NAME=Qwen/Qwen3-8B
```

Install the dependencies for the service being tested, then run the test suite:

```bash
pip install -r requirements/requirements-test.txt
PYTHONPATH=. pytest -q
```

The tests mock the model and database adapter for routing and health checks; they do not require downloading the model, a GPU, or a live database. To launch the inference API locally, run `python -m src.inference.app` with a working model and an implemented database adapter. Its health route is `GET http://localhost:80/ping` and generation route is `POST http://localhost:80/generate`.

## Docker Hub builds

Choose your Docker Hub username and use immutable version tags. Run these commands from the `backend/` directory:

```bash
docker build --platform linux/amd64 -f docker/Dockerfile.builder \
  -t <docker-user>/mech-platform:builder-v0.1.0 .

docker build --platform linux/amd64 -f docker/Dockerfile.inference \
  -t <docker-user>/mech-platform:inference-v0.1.0 .

docker push <docker-user>/mech-platform:builder-v0.1.0
docker push <docker-user>/mech-platform:inference-v0.1.0
```

The Dockerfiles use the existing project base pin, `pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime`, with CUDA and PyTorch supplied by that image. Both images have explicit entry points: `python -m src.builder.handler` and `python -m src.inference.app`. There is no service-mode launcher.

## RunPod deployment mapping

Create **exactly two** deployments:

| Deployment | Image | Endpoint type | Purpose |
|---|---|---|---|
| Builder | `<docker-user>/mech-platform:builder-v0.1.0` | Queue-based Serverless | Create steering vectors. Start with 0 active workers; configure 1 GPU per worker. |
| Inference | `<docker-user>/mech-platform:inference-v0.1.0` | Load Balancer Serverless | Text generation through `/ping` and `/generate`; configure 1 GPU per worker. |

Set the model and database environment variables on both endpoints. The application backend calls the builder queue for vector creation and the inference load balancer for generation. The two RunPod endpoints do not call each other; the database is their shared persistence layer.

## Builder request

```json
{
  "input": {
    "action": "create_steering",
    "artifact_id": "sv_123",
    "layer": 20,
    "positive_examples": ["Example positive text", "Another positive example"],
    "negative_examples": ["Example negative text", "Another negative example"]
  }
}
```

Successful jobs return only metadata:

```json
{"status":"complete","artifact_id":"sv_123","type":"steering"}
```

The queue currently accepts `create_steering`. Probe creation is deliberately not implemented; unsupported actions fail with a clear error.

## Inference requests

All requests use `POST /generate`.

Normal generation:

```json
{"prompt":"Explain mechanistic interpretability.","max_new_tokens":256,"temperature":0.7}
```

Steering generation:

```json
{
  "prompt":"Explain mechanistic interpretability.",
  "steering":{"artifact_id":"sv_123","layer":20,"strength":3.0}
}
```

Probe request shape (deferred; currently returns HTTP 501):

```json
{
  "prompt":"Explain mechanistic interpretability.",
  "probe":{"artifact_id":"probe_123","layer":20}
}
```

Steering plus probe request shape (deferred; currently returns HTTP 501):

```json
{
  "prompt":"Explain mechanistic interpretability.",
  "steering":{"artifact_id":"sv_123","layer":18,"strength":3.0},
  "probe":{"artifact_id":"probe_456","layer":24}
}
```

`prompt` must be non-empty; `max_new_tokens` is an integer from 1 to 4096; `temperature` must be greater than 0 and at most 5. Steering and probe layers must be non-negative integers. The selected steering layer must exist in the stored artifact and loaded model.
