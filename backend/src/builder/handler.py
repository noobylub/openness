"""RunPod queue entry point for steering-vector creation."""

from __future__ import annotations

import logging
import re
from typing import Any

import runpod

from src.common.artifacts import get_artifact_store
from src.common.model import get_model_id, load_model
from src.algorithms.extract import extract_steering_vector


logger = logging.getLogger(__name__)
_ARTIFACT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
model = None
tokenizer = None
artifact_store = None


def handler(job: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(job, dict) or not isinstance(job.get("input"), dict):
        raise ValueError("job must contain an input object.")
    data = job["input"]
    action = data.get("action")
    if action != "create_steering":
        raise ValueError(f"Unsupported action: {action!r}. Supported action: 'create_steering'.")
    if model is None or tokenizer is None or artifact_store is None:
        raise RuntimeError("Builder worker is not initialized.")

    artifact_id = data.get("artifact_id")
    layer = data.get("layer")
    positive_examples = data.get("positive_examples")
    negative_examples = data.get("negative_examples")
    if not isinstance(artifact_id, str) or not _ARTIFACT_ID_RE.fullmatch(artifact_id):
        raise ValueError("artifact_id must be 1-128 safe letters, digits, '.', '_' or '-'.")
    if isinstance(layer, bool) or not isinstance(layer, int):
        raise ValueError("layer must be an integer.")
    for name, examples in (
        ("positive_examples", positive_examples),
        ("negative_examples", negative_examples),
    ):
        if not isinstance(examples, list) or not examples:
            raise ValueError(f"{name} must be a non-empty list of strings.")
        if any(not isinstance(text, str) or not text.strip() for text in examples):
            raise ValueError(f"{name} must contain only non-empty strings.")
    if layer < 0 or layer >= model.config.num_hidden_layers:
        raise ValueError(f"layer must be in [0, {model.config.num_hidden_layers - 1}].")
    batch_size = data.get("batch_size", 8)
    if isinstance(batch_size, bool) or not isinstance(batch_size, int) or batch_size < 1:
        raise ValueError("batch_size must be a positive integer.")

    vector = extract_steering_vector(
        model=model,
        tokenizer=tokenizer,
        positive_text=positive_examples,
        negative_text=negative_examples,
        layers=layer,
        batch_size=batch_size,
    )
    artifact_store.save_artifact(
        artifact_id=artifact_id,
        artifact_type="steering",
        artifact={"positive_minus_negative": vector},
        metadata={
            "model_id": get_model_id(),
            "layers": [layer],
            "positive_count": len(positive_examples),
            "negative_count": len(negative_examples),
        },
    )
    logger.info("Saved steering artifact %s", artifact_id)
    return {"status": "complete", "artifact_id": artifact_id, "type": "steering"}


def main() -> None:
    global model, tokenizer, artifact_store
    logging.basicConfig(level=logging.INFO)
    model, tokenizer = load_model()
    artifact_store = get_artifact_store()
    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    main()