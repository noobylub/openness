"""Steering hooks and generation helpers used by the generation dispatcher."""
import torch


def norm_vectors(vectors):
    """
    Receive the full [num_layers, hidden_size] steering vectors
    Normalise each vector to have unit norm, so that we can apply them with a consistent strength across layers without some layers dominating due to larger magnitudes.
    """
    normed_vectors = torch.zeros_like(vectors)
    for i, vector in enumerate(vectors):
        normed_vectors[i] = vector / torch.norm(vector)
    return normed_vectors


def _extractVectorSteer(module, input, output, steering_vector, strength, layer_idx):
    if isinstance(output, tuple):
        hidden_state = output[0]
        is_tuple = True
    else:
        hidden_state = output
        is_tuple = False

    layer_vector = steering_vector[layer_idx]  # pick corresponding [hidden_size] for this layer

    if layer_vector.device != hidden_state.device:
        layer_vector = layer_vector.to(hidden_state.device)
    if layer_vector.dtype != hidden_state.dtype:
        layer_vector = layer_vector.to(hidden_state.dtype)

    # Clone and apply steering to all token positions
    steered_hidden = hidden_state.clone()
    steered_hidden = steered_hidden + (layer_vector * strength)

    # Soemtimes the output can be a tuple, containing the previous keys and those likes
    # So we only want to modify the first part
    if is_tuple:
        return (steered_hidden,) + output[1:]
    else:
        return steered_hidden


class SteeringApplier:
    """Registers forward hooks that add a steering vector to chosen layers' outputs."""

    def __init__(self, model, steering_vector, strength=1.0, target_layers=None):
        self.model = model
        self.steering_vector = steering_vector.to(model.device)
        self.strength = strength
        self.target_layers = target_layers if target_layers is not None else list(range(model.config.num_hidden_layers))
        self.hook_handles = []

    def _hook_fn(self, module, input, output, layer_idx):
        return _extractVectorSteer(
            module, input, output, self.steering_vector, self.strength, layer_idx
        )

    def __enter__(self):
        for layer_idx in self.target_layers:
            handle = self.model.model.layers[layer_idx].register_forward_hook(
                lambda module, input, output, idx=layer_idx: self._hook_fn(module, input, output, idx)
            )
            self.hook_handles.append(handle)

    def __exit__(self, exc_type, exc_val, exc_tb):
        for handle in self.hook_handles:
            handle.remove()
        self.hook_handles = []


def generateSteering(
    user_text: str,
    system_text: str,
    model,
    tokenizer,
    steering_vector=None,   # expected shape [num_layers, hidden_size]
    steering_strength=1.0,
    target_layers=None,
    max_new_tokens=200,
    temperature=0.7,
    do_sample=True,
    return_hidden_states=False
):
    """Generate text with optional steering applied to specified layers."""
    messages = [
        {"role": "system", "content": system_text},
        {"role": "user", "content": user_text}
    ]

    # Apply chat template without tokenizing, then tokenize separately
    text_for_model = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True
    )

    inputs = tokenizer(
        text_for_model,
        return_tensors="pt"
    ).to(model.device)

    # we want to make sure the steering vector is on the same device
    # AND that the steering vector is the correct shape and type
    if steering_vector is not None:
        if steering_vector.shape[0] != model.config.num_hidden_layers or steering_vector.shape[1] != model.config.hidden_size:
            raise ValueError(f"steering_vector must have shape [{model.config.num_hidden_layers}, {model.config.hidden_size}]")
        if steering_vector.device != model.device:
            steering_vector = steering_vector.to(model.device)
        if steering_vector.dtype != next(model.parameters()).dtype:
            steering_vector = steering_vector.to(next(model.parameters()).dtype)

    input_ids = inputs["input_ids"]
    attention_mask = inputs["attention_mask"]

    # Guard: cannot extract hidden states with steering (would require hooks + dict output logic)
    if return_hidden_states and steering_vector is not None:
        raise ValueError("return_hidden_states=True is only supported when steering_vector is None")

    # Only wrap wrapper if steering_vector is provided, otherwise just generate normally
    if steering_vector is None:
        with torch.no_grad():
            outputs = model.generate(
                input_ids=input_ids,
                attention_mask=attention_mask,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                do_sample=do_sample,
                pad_token_id=tokenizer.eos_token_id,
                eos_token_id=tokenizer.eos_token_id,
                return_dict_in_generate=return_hidden_states,
                output_hidden_states=return_hidden_states
            )
    else:
        with SteeringApplier(model, steering_vector, steering_strength, target_layers):
            with torch.no_grad():
                outputs = model.generate(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    max_new_tokens=max_new_tokens,
                    temperature=temperature,
                    do_sample=do_sample,
                    pad_token_id=tokenizer.eos_token_id,
                    eos_token_id=tokenizer.eos_token_id,
                )

    input_length = input_ids.shape[1]
    if return_hidden_states:
        return outputs.hidden_states
    else:
        generated_text = tokenizer.decode(outputs[0][input_length:], skip_special_tokens=True)
        return generated_text


def generateBatchedSteering(
    user_texts: list[str],
    system_text: str,
    model,
    tokenizer,
    steering_vector=None,
    steering_strength=1.0,
    target_layers=None,
    max_new_tokens=200,
    temperature=0.7,
    do_sample=True,
):
    """Generate text for a batch of user_texts with optional steering applied to specified layers."""
    # Build one independent chat prompt per user text so generation is truly batched.
    prompts_for_model = [
        tokenizer.apply_chat_template(
            [
                {"role": "system", "content": system_text},
                {"role": "user", "content": text},
            ],
            tokenize=False,
            add_generation_prompt=True,
        )
        for text in user_texts
    ]

    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    original_padding_side = tokenizer.padding_side
    tokenizer.padding_side = "left"
    try:
        inputs = tokenizer(
            prompts_for_model,
            return_tensors="pt",
            padding=True,
            truncation=True,
        ).to(model.device)
    finally:
        tokenizer.padding_side = original_padding_side

    # we want to make sure the steering vector is on the same device
    # AND that the steering vector is the correct shape and type
    if steering_vector is not None:
        if steering_vector.shape[0] != model.config.num_hidden_layers or steering_vector.shape[1] != model.config.hidden_size:
            raise ValueError(f"steering_vector must have shape [{model.config.num_hidden_layers}, {model.config.hidden_size}]")
        if steering_vector.device != model.device:
            steering_vector = steering_vector.to(model.device)
        if steering_vector.dtype != next(model.parameters()).dtype:
            steering_vector = steering_vector.to(next(model.parameters()).dtype)

    input_ids = inputs["input_ids"]
    attention_mask = inputs["attention_mask"]
    # For batched generation, new tokens always start after the full padded input width.
    # Using per-row non-pad lengths leaks part of the prompt when padding_side='left'.
    prompt_width = input_ids.shape[1]

    if steering_vector is None:
        with torch.no_grad():
            outputs = model.generate(
                input_ids=input_ids,
                attention_mask=attention_mask,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                do_sample=do_sample,
                pad_token_id=tokenizer.eos_token_id,
                eos_token_id=tokenizer.eos_token_id,
            )
    else:
        with SteeringApplier(model, steering_vector, steering_strength, target_layers):
            with torch.no_grad():
                outputs = model.generate(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    max_new_tokens=max_new_tokens,
                    temperature=temperature,
                    do_sample=do_sample,
                    pad_token_id=tokenizer.eos_token_id,
                    eos_token_id=tokenizer.eos_token_id,
                )

    generated_token_seqs = [
        outputs[i][prompt_width:]
        for i in range(len(user_texts))
    ]
    generated_texts = tokenizer.batch_decode(
        generated_token_seqs,
        skip_special_tokens=True
    )
    return generated_texts
