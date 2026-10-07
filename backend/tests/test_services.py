from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import torch
from fastapi.testclient import TestClient

from src.builder import handler as builder
from src.common.artifacts import (
    ArtifactCache,
    ArtifactRecord,
    decode_metadata,
    decode_tensors,
    encode_metadata,
    encode_tensors,
)
from src.inference import app as inference
from src.inference.app import GenerationRequest


def test_builder_routes_create_steering(monkeypatch):
    store = Mock()
    monkeypatch.setattr(builder, "model", SimpleNamespace(config=SimpleNamespace(num_hidden_layers=24)))
    monkeypatch.setattr(builder, "tokenizer", object())
    monkeypatch.setattr(builder, "artifact_store", store)
    monkeypatch.setattr(builder, "get_model_id", lambda: "test-model")
    monkeypatch.setattr(builder, "extract_steering_vector", lambda **kwargs: torch.ones(1, 4))

    result = builder.handler({"input": {
        "action": "create_steering",
        "artifact_id": "sv_test",
        "layer": 20,
        "positive_examples": ["positive"],
        "negative_examples": ["negative"],
    }})

    assert result == {"status": "complete", "artifact_id": "sv_test", "type": "steering"}
    store.save_artifact.assert_called_once()
    assert store.save_artifact.call_args.kwargs["metadata"]["layers"] == [20]


def test_builder_rejects_unimplemented_action():
    with pytest.raises(ValueError, match="Unsupported action"):
        builder.handler({"input": {"action": "create_probe"}})


@pytest.mark.parametrize(
    ("payload", "expected_mode"),
    [
        ({"prompt": "hello"}, "plain"),
        ({"prompt": "hello", "steering": {"artifact_id": "sv", "layer": 2}}, "steering"),
        ({"prompt": "hello", "probe": {"artifact_id": "p", "layer": 3}}, "probe"),
        ({"prompt": "hello", "steering": {"artifact_id": "sv", "layer": 2}, "probe": {"artifact_id": "p", "layer": 3}}, "probe_and_steering"),
    ],
)
def test_generation_request_modes(payload, expected_mode):
    assert GenerationRequest.model_validate(payload).mode == expected_mode


def test_artifact_cache_reuses_store_value():
    record = ArtifactRecord(tensors={"artifact": torch.ones(1)}, metadata={})
    store = Mock()
    store.load_artifact.return_value = record
    cache = ArtifactCache(store, max_items=2)

    assert cache.get("sv1", "steering") is record
    assert cache.get("sv1", "steering") is record
    store.load_artifact.assert_called_once_with("sv1", "steering")


def test_database_payload_helpers_round_trip():
    tensor = torch.arange(4, dtype=torch.float32).reshape(1, 4)
    restored_tensor = decode_tensors(encode_tensors({"positive_minus_negative": tensor}))
    restored_metadata = decode_metadata(encode_metadata({"layers": [20]}))

    assert torch.equal(restored_tensor["positive_minus_negative"], tensor)
    assert restored_metadata == {"layers": [20]}


def test_ping_is_unhealthy_until_worker_ready():
    client = TestClient(inference.app)
    assert client.get("/ping").status_code == 204

    monkeypatch_values = {
        "load_model": lambda: (object(), object()),
        "get_artifact_store": lambda: Mock(),
    }
    with pytest.MonkeyPatch.context() as monkeypatch:
        for name, value in monkeypatch_values.items():
            monkeypatch.setattr(inference, name, value)
        with TestClient(inference.app) as ready_client:
            response = ready_client.get("/ping")
            assert response.status_code == 200
            assert response.json() == {"status": "ok"}