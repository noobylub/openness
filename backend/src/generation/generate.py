"""Dispatch generation requests to the existing generation implementation."""

from src.algorithms.generate import generateSteering


def generate_text(
    *,
    model,
    tokenizer,
    prompt: str,
    max_new_tokens: int,
    temperature: float,
    steering_vector=None,
    steering_layer: int | None = None,
    steering_strength: float = 1.0,
    probe=None,
):
    if probe is not None:
        raise NotImplementedError("Probe generation is not integrated yet.")
    return generateSteering(
        user_text=prompt,
        system_text="",
        model=model,
        tokenizer=tokenizer,
        steering_vector=steering_vector,
        steering_strength=steering_strength,
        target_layers=[steering_layer] if steering_layer is not None else None,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
    )