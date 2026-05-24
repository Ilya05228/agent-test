"""
Demo: local RAG pipeline with sample documents.

Run:
    python rag/example.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from rag.pipeline import RAGPipeline


def main():
    print("=" * 60)
    print("Initializing RAG pipeline …")
    rag = RAGPipeline()

    # ---- Ingest sample documents ----
    docs = [
        "Python is a high-level, interpreted programming language known for its readability. "
        "It supports multiple paradigms including procedural, object-oriented, and functional programming.",

        "Rust is a systems programming language focused on safety, speed, and concurrency. "
        "It achieves memory safety without a garbage collector through its ownership system.",

        "Machine learning is a subset of artificial intelligence that enables systems to learn "
        "from data. Popular frameworks include PyTorch, TensorFlow, and scikit-learn.",

        "Docker is a platform for developing, shipping, and running applications in containers. "
        "Containers package an application with all its dependencies into a standardized unit.",

        "ChromaDB is an open-source vector database designed for AI applications. "
        "It stores embeddings and enables semantic search over unstructured data.",
    ]

    print(f"Ingesting {len(docs)} documents …")
    rag.ingest_texts(docs)
    print(f"Collection size: {rag.doc_count}")

    # ---- Query ----
    questions = [
        "What is Python?",
        "How does Rust manage memory?",
        "What tools are used for machine learning?",
    ]

    for q in questions:
        print(f"\n{'─' * 60}")
        print(f"Q: {q}")
        print(f"{'─' * 60}")

        # Optional: inspect retrieved docs
        # retrieved = rag.retrieve(q)
        # for i, doc in enumerate(retrieved):
        #     print(f"  [{i}] {doc[:120]}...")

        answer = rag.query(q)
        print(f"A: {answer}")


if __name__ == "__main__":
    main()
