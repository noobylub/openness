"""Shared model-loading interface used independently by both services."""

from model_loader import get_model_id, load_model as _load_model


def load_model():
    """Load or return the process-local model and tokenizer."""
    return _load_model()


__all__ = ["get_model_id", "load_model"]