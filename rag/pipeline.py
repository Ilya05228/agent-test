"""
Local RAG pipeline.
Stack: ChromaDB (vector store) + all-MiniLM-L6-v2 (embeddings) + Qwen2.5-1.5B GGUF (LLM).

Usage:
    from rag.pipeline import RAGPipeline

    rag = RAGPipeline()
    rag.ingest_texts(["Python is a programming language.", "Rust is a systems language."])
    answer = rag.query("What is Python?")
    print(answer)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import List, Optional

import chromadb
from chromadb.utils import embedding_functions
from llama_cpp import Llama

_MODEL_DIR = Path(__file__).resolve().parent / "models"
_MODEL_DIR.mkdir(exist_ok=True)

# --- Model URLs / paths ---
_GGUF_URL = (
    "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/"
    "qwen2.5-1.5b-instruct-q4_k_m.gguf"
)
_GGUF_FILENAME = "qwen2.5-1.5b-instruct-q4_k_m.gguf"


def _download_model() -> Path:
    """Download the GGUF model if not already present. Returns local path."""
    dest = _MODEL_DIR / _GGUF_FILENAME
    if dest.exists():
        return dest

    print(f"Downloading model to {dest} …", file=sys.stderr)
    import urllib.request

    def _report(count, block_size, total_size):
        pct = int(count * block_size * 100 / total_size) if total_size else 0
        print(f"\r  {pct}%", end="", file=sys.stderr)

    urllib.request.urlretrieve(_GGUF_URL, str(dest), reporthook=_report)
    print(file=sys.stderr)
    return dest


class RAGPipeline:
    """End-to-end RAG: ingest documents, query with retrieved context."""

    def __init__(
        self,
        persist_dir: str | None = None,
        n_ctx: int = 4096,
        n_gpu_layers: int = -1,
    ):
        """
        Args:
            persist_dir: ChromaDB persistence directory. Default: ./chroma_data
            n_ctx: LLM context window size.
            n_gpu_layers: Number of layers to offload to GPU (-1 = all if GPU available).
        """
        persist_dir = persist_dir or str(Path.cwd() / "chroma_data")

        # --- LLM ---
        model_path = _download_model()
        self._llm = Llama(
            str(model_path),
            n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers,
            verbose=False,
        )

        # --- Embedder (all-MiniLM-L6-v2, ~80 MB, downloads on first use) ---
        self._embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name="all-MiniLM-L6-v2",
        )

        # --- Vector store ---
        self._client = chromadb.PersistentClient(path=persist_dir)
        self._collection = self._client.get_or_create_collection(
            name="rag_docs",
            embedding_function=self._embed_fn,
        )

    # ------------------------------------------------------------------
    # Ingest
    # ------------------------------------------------------------------

    def ingest_texts(self, texts: List[str], metadatas: List[dict] | None = None) -> None:
        """Index a batch of text documents. Each text becomes one chunk."""
        if not texts:
            return
        ids = [str(i) for i in range(self._collection.count(), self._collection.count() + len(texts))]
        self._collection.add(documents=texts, ids=ids, metadatas=metadatas)

    def ingest_file(self, filepath: str, chunk_size: int = 500, chunk_overlap: int = 100) -> None:
        """Read a text file, split into overlapping chunks, and index."""
        text = Path(filepath).read_text(encoding="utf-8")
        chunks = self._split_text(text, chunk_size, chunk_overlap)
        self.ingest_texts(chunks)

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def query(
        self,
        question: str,
        n_results: int = 4,
        max_tokens: int = 512,
        temperature: float = 0.1,
    ) -> str:
        """Ask a question; returns the LLM answer grounded in retrieved documents."""
        # Retrieve
        results = self._collection.query(query_texts=[question], n_results=n_results)
        docs: List[str] = results["documents"][0] if results["documents"] else []

        if not docs:
            return "No relevant documents found."

        # Build prompt
        context = "\n\n---\n\n".join(docs)
        prompt = (
            "You are a helpful assistant. Use the following documents to answer the question. "
            "If the documents do not contain the answer, say so.\n\n"
            f"Documents:\n{context}\n\n"
            f"Question: {question}\n"
            "Answer:"
        )

        # Generate
        output = self._llm(
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            stop=["Question:", "\n\n\n"],
        )
        return output["choices"][0]["text"].strip()

    def retrieve(self, question: str, n_results: int = 4) -> List[str]:
        """Return raw retrieved documents without generation (inspect mode)."""
        results = self._collection.query(query_texts=[question], n_results=n_results)
        return results["documents"][0] if results["documents"] else []

    @property
    def doc_count(self) -> int:
        return self._collection.count()

    def drop_all(self) -> None:
        """Delete all indexed documents."""
        self._client.delete_collection("rag_docs")
        self._collection = self._client.get_or_create_collection(
            name="rag_docs",
            embedding_function=self._embed_fn,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _split_text(text: str, chunk_size: int, chunk_overlap: int) -> List[str]:
        """Split text into overlapping chunks, respecting word boundaries."""
        words = text.split()
        chunks: List[str] = []
        step = max(1, chunk_size - chunk_overlap)
        for i in range(0, len(words), step):
            chunk = " ".join(words[i : i + chunk_size])
            chunks.append(chunk)
        return chunks
