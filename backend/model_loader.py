"""Loads the Hugging Face model/tokenizer once per worker process.

Runpod best practice: initialize heavy resources at module import time, not
inside the handler, so they are reused across every job the worker receives.
Only one model per worker is supported for now (set via MODEL_NAME or MODEL_ID).
"""
import logging
import os

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

logger = logging.getLogger("model_loader")

_DTYPE_MAP = {
    "bfloat16": torch.bfloat16,
    "float16": torch.float16,
    "float32": torch.float32,
}

_model = None
_tokenizer = None
_model_id = None


def load_model():
    """Load the model/tokenizer if not already loaded, then return them."""
    global _model, _tokenizer, _model_id

    if _model is not None and _tokenizer is not None:
        return _model, _tokenizer

    model_id = os.environ.get("MODEL_NAME") or os.environ.get("MODEL_ID")
    if not model_id:
        raise RuntimeError("MODEL_NAME (or legacy MODEL_ID) environment variable must be set.")

    dtype_name = os.environ.get("TORCH_DTYPE", "bfloat16")
    torch_dtype = _DTYPE_MAP.get(dtype_name, torch.bfloat16)

    logger.info("model loading: %s (dtype=%s)", model_id, dtype_name)

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        torch_dtype=torch_dtype,
        device_map="auto",
    )
    model.eval()

    _model, _tokenizer, _model_id = model, tokenizer, model_id
    logger.info("model loaded: %s", model_id)
    return _model, _tokenizer


def get_model_id():
    return _model_id
