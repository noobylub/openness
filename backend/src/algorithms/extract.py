"""
Steering-vector extraction: hidden-state capture, mean pooling, and
contrastive vector computation.

Methodology reference:
https://elib.dlr.de/218629/1/The_Effectiveness_of_Style_Vectors_for_Steering_Large_Language_Models_A_Human_Evaluation.pdf

This module has no knowledge of RunPod or persistence. The builder service
persists the result after extraction completes.
"""
import torch

# We only want to extract specified layers and contrast positive against negative prompts.
def extract_steering_vector(
    model,
    tokenizer,
    positive_text: list[str],
    negative_text: list[str],
    layers: int | list[int],
    batch_size: int = 8,
):
    """Return positive-minus-negative mean activations, shape [layers, hidden_size]."""
    if not positive_text or not negative_text:
        raise ValueError("positive_text and negative_text must both contain prompts.")
    if isinstance(layers, int):
        layers = [layers]
    if not layers or any(layer < 0 or layer >= model.config.num_hidden_layers for layer in layers):
        raise ValueError(f"layers must be valid indices in [0, {model.config.num_hidden_layers - 1}].")
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1.")

    def mean_activations(texts):
        total = torch.zeros(
            len(layers), model.config.hidden_size, dtype=torch.float32
        )
        for itr in range(0, len(texts), batch_size):
            # Batching texts and applying template if it exists
            batch_texts = texts[itr:itr + batch_size]
            if tokenizer.chat_template is not None:
                batch_texts = [
                    tokenizer.apply_chat_template(
                        [{"role": "user", "content": text}],
                        tokenize=False,
                        add_generation_prompt=True,
                    )
                    for text in batch_texts
                ]

            # Padding to make sure all is equal 
            if tokenizer.pad_token_id is None:
                tokenizer.pad_token = tokenizer.eos_token

            # Actually tokenising the batched inputs
            inputs = tokenizer(
                batch_texts,
                return_tensors="pt",
                padding=True,
            ).to(model.device)

            # Running the texts, to get hidden states
            with torch.no_grad():
                outputs = model(**inputs, output_hidden_states=True)

            mask = inputs["attention_mask"].unsqueeze(-1)
            token_counts = mask.sum(dim=1).clamp_min(1)
            for output_index, layer_index in enumerate(layers):
                hidden = outputs.hidden_states[layer_index + 1]
                per_prompt_means = (hidden * mask).sum(dim=1) / token_counts
                total[output_index] += per_prompt_means.sum(dim=0).float().cpu()

            del outputs

        return total / len(texts)

    return mean_activations(positive_text) - mean_activations(negative_text)


# def statistics_cosine_similarity(emotion_sets: dict):
#     """
#     Calculate contrastive steering vectors from lists of existing vectors.
#     """
#     if not isinstance(emotion_sets, dict) or len(emotion_sets) < 2:
#         raise ValueError("emotion_sets must contain at least 2 emotions.")

#     mean_vectors = {}
#     for emotion, vectors in emotion_sets.items():
#         if not vectors:
#             raise ValueError(f"Emotion '{emotion}' has no vectors.")
#         mean_vectors[emotion] = torch.stack(
#             [torch.as_tensor(vector) for vector in vectors], dim=0
#         ).mean(dim=0)

#     emotion_vectors = {}
#     for target in mean_vectors:
#         # Take the mean of all other emotion vectors to create a contrastive vector.
#         contrastive = torch.stack(
#             [mean_vectors[e] for e in mean_vectors if e != target], dim=0
#         ).mean(dim=0)   # [layers, hidden_size]
#         emotion_vectors[target] = mean_vectors[target] - contrastive

#     return emotion_vectors


def retrieve_steering_vector(
    model,
    tokenizer,
    emotion_sets: dict,
    layer_id=[21],
    only_return_emotion_vectors=False,
    retrieve_all_layers=False
    ):
    """
    Retrieves a steering vector for a given emotion by passing the emotional text as inference
    Then receiving the hidden state and subtracting the mean of the other emotion hidden states to get a contrastive vector
    However if only_return_emotion_vectors is True, it will return the mean hidden state vectors for each emotion instead of the contrastive steering vectors.

    NOTE: this function stays storage-agnostic. The builder service owns
    persistence after extraction completes.
    """
    if not isinstance(emotion_sets, dict) or not emotion_sets:
        raise ValueError("emotion_sets must be a non-empty dict of {emotion: prompts}.")

    if len(emotion_sets) < 2:
        raise ValueError("emotion_sets must contain at least 2 emotions to compute contrastive steering vectors.")

    hidden_layers = model.config.num_hidden_layers
    hidden_size = model.config.hidden_size

    if isinstance(layer_id, int):
        layer_id = [layer_id]
    if not layer_id:
        raise ValueError("layer_id must contain at least one layer index.")
    if any((lid < 0 or lid >= hidden_layers) for lid in layer_id):
        raise ValueError(f"layer_id values must be in [0, {hidden_layers - 1}].")

    emotion_vectors = {emotion: [] for emotion in emotion_sets}
    vectors = {emotion: torch.zeros(hidden_layers, hidden_size) for emotion in emotion_sets}
    steering_vectors = {}

    # Extracting total vectors for each emotion amd doing the calculation
    for emotion, prompts in emotion_sets.items():
        if not prompts:
            raise ValueError(f"Emotion '{emotion}' has no prompts.")
        for prompt in prompts:
            vector = _extractAllLayer(prompt, model, tokenizer)  # [num_layers, hidden_size]
            # For analysis purposes
            if retrieve_all_layers:
                emotion_vectors[emotion].append(vector.to(torch.float32).cpu().numpy())
            else:
                for lid in layer_id:
                    # Cast to float32 before NumPy conversion to avoid bfloat16 incompatibility.
                    emotion_vectors[emotion].append(vector[lid].to(torch.float32).cpu().numpy())
            vectors[emotion] += vector

    if only_return_emotion_vectors:
        return emotion_vectors

    # Normalize vectors to get means
    for emotion in vectors:
        vectors[emotion] = vectors[emotion] / len(emotion_sets[emotion])

    for target in vectors:
        # Take the mean of all the other emotion vectors to create a contrastive vector
        contrastive = torch.stack(
            [vectors[e] for e in vectors if e != target], dim=0
        ).mean(dim=0)   # [layers, hidden_size]
        steering_vectors[target] = vectors[target] - contrastive  # Both [layers, hidden_size]

    return steering_vectors, emotion_vectors
