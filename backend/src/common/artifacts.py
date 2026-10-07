"""Database persistence boundary and worker-local steering-vector cache."""

from __future__ import annotations

import json
import re
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Protocol

import torch
from safetensors.torch import load as load_safetensors
from safetensors.torch import save as save_safetensors


_ARTIFACT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


@dataclass(frozen=True)
class ArtifactRecord:
    tensors: dict[str, torch.Tensor]
    metadata: dict[str, Any]


class ArtifactStore(Protocol):
    def save_artifact(
        self,
        artifact_id: str,
        artifact_type: str,
        artifact: torch.Tensor | dict[str, torch.Tensor],
        metadata: dict[str, Any] | None = None,
    ) -> None: ...

    def load_artifact(self, artifact_id: str, artifact_type: str) -> ArtifactRecord: ...


def validate_artifact_id(artifact_id: str) -> None:
    if not isinstance(artifact_id, str) or not _ARTIFACT_ID_RE.fullmatch(artifact_id):
        raise ValueError("artifact_id must be 1-128 safe letters, digits, '.', '_' or '-'.")


def encode_tensors(artifact: torch.Tensor | dict[str, torch.Tensor]) -> bytes:
    """Encode tensors in a portable non-pickle format for database storage."""
    tensors = {"artifact": artifact} if isinstance(artifact, torch.Tensor) else artifact
    if not isinstance(tensors, dict) or not tensors:
        raise ValueError("artifact must be a tensor or a non-empty mapping of tensors.")
    if any(not isinstance(name, str) or not isinstance(tensor, torch.Tensor) for name, tensor in tensors.items()):
        raise TypeError("artifact mappings must contain string names and tensor values.")
    cpu_tensors = {
        name: tensor.detach().to(torch.float32).contiguous().cpu()
        for name, tensor in tensors.items()
    }
    return save_safetensors(cpu_tensors)


def decode_tensors(payload: bytes) -> dict[str, torch.Tensor]:
    return load_safetensors(payload)


def encode_metadata(metadata: dict[str, Any]) -> str:
    return json.dumps(metadata, separators=(",", ":"))


def decode_metadata(metadata: str) -> dict[str, Any]:
    return json.loads(metadata)


class DatabaseArtifactStore:
    """Placeholder adapter: connect these methods to the application's database."""

    def save_artifact(
        self,
        artifact_id: str,
        artifact_type: str,
        artifact: torch.Tensor | dict[str, torch.Tensor],
        metadata: dict[str, Any] | None = None,
    ) -> None:
        validate_artifact_id(artifact_id)
        # TODO(database integration): persist encode_tensors(artifact) and
        # encode_metadata(metadata or {}) using the application's DB client.
        raise NotImplementedError("Implement database artifact writes in DatabaseArtifactStore.")

    def load_artifact(self, artifact_id: str, artifact_type: str) -> ArtifactRecord:
        validate_artifact_id(artifact_id)
        # TODO(database integration): query by artifact_id/type, then decode the
        # stored tensor bytes and metadata into an ArtifactRecord.
        raise NotImplementedError("Implement database artifact reads in DatabaseArtifactStore.")


def get_artifact_store() -> ArtifactStore:
    """Return the database adapter used by both services."""
    return DatabaseArtifactStore()


class ArtifactCache:
    """Small bounded LRU cache local to one inference worker process."""

    def __init__(self, store: ArtifactStore, max_items: int = 32):
        if max_items < 1:
            raise ValueError("max_items must be positive.")
        self.store = store
        self.max_items = max_items
        self._items: OrderedDict[tuple[str, str], ArtifactRecord] = OrderedDict()

    def get(self, artifact_id: str, artifact_type: str) -> ArtifactRecord:
        key = (artifact_type, artifact_id)
        if key in self._items:
            self._items.move_to_end(key)
            return self._items[key]
        artifact = self.store.load_artifact(artifact_id, artifact_type)
        self._items[key] = artifact
        if len(self._items) > self.max_items:
            self._items.popitem(last=False)
        return artifact
