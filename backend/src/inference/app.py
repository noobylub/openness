"""HTTP inference entry point for RunPod's load-balancing serverless endpoint."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import Response

from src.common.artifacts import ArtifactCache, ArtifactRecord, get_artifact_store
from src.common.model import load_model
from src.generation import generate_text


class SteeringConfig(BaseModel):
    artifact_id: str = Field(min_length=1, max_length=128)
    layer: int = Field(ge=0, strict=True)
    strength: float = Field(default=1.0, allow_inf_nan=False)


class ProbeConfig(BaseModel):
    artifact_id: str = Field(min_length=1, max_length=128)
    layer: int = Field(ge=0, strict=True)


class GenerationRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    prompt: str = Field(min_length=1, max_length=100_000)
    max_new_tokens: int = Field(default=256, ge=1, le=4096, strict=True)
    temperature: float = Field(default=0.7, gt=0, le=5, allow_inf_nan=False)
    steering: SteeringConfig | None = None
    probe: ProbeConfig | None = None

    @property
    def mode(self) -> Literal["plain", "steering", "probe", "probe_and_steering"]:
        if self.steering and self.probe:
            return "probe_and_steering"
        if self.steering:
            return "steering"
        if self.probe:
            return "probe"
        return "plain"


@asynccontextmanager
async def lifespan(app: FastAPI):
    model, tokenizer = load_model()
    app.state.model = model
    app.state.tokenizer = tokenizer
    app.state.artifact_cache = ArtifactCache(get_artifact_store())
    app.state.generation_lock = asyncio.Lock()
    app.state.ready = True
    try:
        yield
    finally:
        app.state.ready = False


app = FastAPI(title="Mechanistic Interpretability Inference", lifespan=lifespan)
app.state.ready = False


@app.get("/ping")
async def ping():
    if not app.state.ready:
        return Response(status_code=204)
    return {"status": "ok"}


def _steering_tensor(
    artifact: ArtifactRecord,
    requested_layer: int,
    model,
):
    vector = artifact.tensors.get("positive_minus_negative")
    layers = artifact.metadata.get("layers")
    if vector is None or not isinstance(layers, list) or vector.ndim != 2 or len(layers) != vector.shape[0]:
        raise HTTPException(status_code=422, detail="Steering artifact metadata or tensor is invalid.")
    if requested_layer not in layers:
        raise HTTPException(status_code=422, detail="Requested layer is not included in this steering artifact.")
    if requested_layer >= model.config.num_hidden_layers:
        raise HTTPException(status_code=422, detail="Requested layer exceeds the loaded model depth.")

    # The existing hook implementation indexes vectors by absolute model layer.
    expanded = vector.new_zeros((model.config.num_hidden_layers, vector.shape[-1]))
    expanded[requested_layer] = vector[layers.index(requested_layer)]
    return expanded


async def generate(request: GenerationRequest):
    if request.probe is not None:
        raise HTTPException(
            status_code=501,
            detail="Probe inference is not integrated yet; probe creation and runtime support are deferred.",
        )

    if not app.state.ready:
        raise HTTPException(status_code=503, detail="Model is not ready.")

    model = app.state.model
    tokenizer = app.state.tokenizer
    steering_vector = None
    strength = 1.0
    if request.steering is not None:
        try:
            artifact = app.state.artifact_cache.get(request.steering.artifact_id, "steering")
        except Exception as exc:
            raise HTTPException(status_code=404, detail="Steering artifact could not be loaded.") from exc
        steering_vector = _steering_tensor(artifact, request.steering.layer, model)
        strength = request.steering.strength

    # To ensure thread safety, and prevent concurrent modifications to the model during text generation,
    #  we acquire the generation lock.
    async with app.state.generation_lock:
        text = await asyncio.to_thread(
            generate_text,
            model=model,
            tokenizer=tokenizer,
            prompt=request.prompt,
            steering_layer=request.steering.layer if request.steering else None,
            steering_vector=steering_vector,
            steering_strength=strength,
            max_new_tokens=request.max_new_tokens,
            temperature=request.temperature,
        )
    return {"text": text, "mode": request.mode}


@app.post("/generate")
async def generate_route(request: GenerationRequest):
    return await generate(request)


def main() -> None:
    import os

    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "80")))


if __name__ == "__main__":
    main()