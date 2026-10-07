"""Input validation for the steering-vector extraction job.

Kept separate from handler.py so validation rules are easy to find/update,
and so the handler never has to guess between a validation failure and a
genuine runtime error.
"""
import os
import re
import uuid

MAX_GROUPS = int(os.environ.get("MAX_GROUPS", "50"))
MAX_EXAMPLES_PER_GROUP = int(os.environ.get("MAX_EXAMPLES_PER_GROUP", "1000"))
MAX_TEXT_CHARS = int(os.environ.get("MAX_TEXT_CHARS", "8000"))

_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_\-]")


class ValidationError(ValueError):
    """Raised when job input fails validation (returned to caller, not raised as a 500)."""


def _sanitize_name(name: str) -> str:
    cleaned = _SAFE_NAME_RE.sub("_", name).strip("_")
    return cleaned or "steering_vector"


# def validate_input(positive_text: list[str], negative_text: list[str], layers: int) -> dict:
#     # if not isinstance(job_input, dict):
#     #     raise ValidationError("'input' must be a JSON object.")
#     if 
    # emotion_sets = job_input.get("emotion_sets")
    # if emotion_sets is None:
    #     raise ValidationError("'emotion_sets' is required.")
    # if not isinstance(emotion_sets, dict):
    #     raise ValidationError("'emotion_sets' must be an object mapping group name -> list of strings.")
    # if len(emotion_sets) < 2:
    #     raise ValidationError("'emotion_sets' must contain at least 2 groups.")
    # if len(emotion_sets) > MAX_GROUPS:
    #     raise ValidationError(f"'emotion_sets' must contain at most {MAX_GROUPS} groups.")

    # cleaned_sets = {}
    # for group, texts in emotion_sets.items():
    #     if not isinstance(group, str) or not group.strip():
    #         raise ValidationError("Group names must be non-empty strings.")
    #     if not isinstance(texts, list) or len(texts) == 0:
    #         raise ValidationError(f"Group '{group}' must contain at least one string.")
    #     if len(texts) > MAX_EXAMPLES_PER_GROUP:
    #         raise ValidationError(
    #             f"Group '{group}' has {len(texts)} examples, exceeding the limit of {MAX_EXAMPLES_PER_GROUP}."
    #         )
    #     cleaned_texts = []
    #     for text in texts:
    #         if not isinstance(text, str) or not text.strip():
    #             raise ValidationError(f"Group '{group}' contains a non-string or empty entry.")
    #         if len(text) > MAX_TEXT_CHARS:
    #             raise ValidationError(
    #                 f"Group '{group}' contains text longer than {MAX_TEXT_CHARS} characters."
    #             )
    #         cleaned_texts.append(text)
    #     cleaned_sets[group] = cleaned_texts

    # name = job_input.get("name") or f"vector_{uuid.uuid4().hex[:8]}"
    # if not isinstance(name, str):
    #     raise ValidationError("'name' must be a string.")
    # name = _sanitize_name(name)

    # layer_ids = job_input.get("layer_ids")
    # if layer_ids is not None:
    #     if not isinstance(layer_ids, list) or not all(isinstance(x, int) and not isinstance(x, bool) for x in layer_ids):
    #         raise ValidationError("'layer_ids' must be a list of integers.")
    #     if not layer_ids:
    #         raise ValidationError("'layer_ids' must not be empty when provided.")
    #     for lid in layer_ids:
    #         if lid < 0 or lid >= num_hidden_layers:
    #             raise ValidationError(
    #                 f"'layer_ids' values must be in [0, {num_hidden_layers - 1}], got {lid}."
    #             )
    # else:
    #     layer_ids = [num_hidden_layers // 2]  # sensible default: a middle layer

    # retrieve_all_layers = job_input.get("retrieve_all_layers", False)
    # if not isinstance(retrieve_all_layers, bool):
    #     raise ValidationError("'retrieve_all_layers' must be a boolean.")

    # return {
    #     "emotion_sets": cleaned_sets,
    #     "name": name,
    #     "layer_ids": layer_ids,
    #     "retrieve_all_layers": retrieve_all_layers,
    # }
