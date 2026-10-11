from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections import defaultdict, deque
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .rag import (
    OLLAMA_URL,
    RagError,
    answer_from_evidence,
    classify_scope,
    ollama_models,
    rank_evidence,
    search_europe_pmc,
)


CHAT_MODEL = os.getenv("MOLECULE3D_CHAT_MODEL", "qwen3:4b")
EMBED_MODEL = os.getenv("MOLECULE3D_EMBED_MODEL", "nomic-embed-text")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", OLLAMA_URL)
if not OLLAMA_HOST.startswith(("http://", "https://")):
    OLLAMA_HOST = f"http://{OLLAMA_HOST}"
MAX_HISTORY = 6

app = FastAPI(title="Molecule3D local RAG", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://adnation911.github.io",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ChatRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1200)
    conversation_id: str | None = Field(default=None, max_length=80)


conversations: dict[str, deque[dict[str, str]]] = defaultdict(lambda: deque(maxlen=MAX_HISTORY))
source_cache: dict[str, dict[str, Any]] = {}
requests_by_ip: dict[str, deque[float]] = defaultdict(deque)


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    window = requests_by_ip[ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= 15:
        raise HTTPException(status_code=429, detail="Please wait a moment before asking another question.")
    window.append(now)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    try:
        models = await asyncio.to_thread(ollama_models, OLLAMA_HOST)
    except RagError as error:
        return {"status": "unavailable", "detail": str(error), "chat_model": CHAT_MODEL, "embed_model": EMBED_MODEL}
    missing = [model for model in (CHAT_MODEL, EMBED_MODEL) if model not in models and f"{model}:latest" not in models]
    return {
        "status": "ready" if not missing else "setup_required",
        "chat_model": CHAT_MODEL,
        "embed_model": EMBED_MODEL,
        "missing_models": missing,
    }


@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request) -> dict[str, Any]:
    _check_rate_limit(request.client.host if request.client else "local")
    question = " ".join(payload.question.split())
    conversation_id = payload.conversation_id or str(uuid.uuid4())
    history = list(conversations[conversation_id])
    try:
        in_scope = await asyncio.to_thread(classify_scope, question, CHAT_MODEL, OLLAMA_HOST)
        if not in_scope:
            return {
                "conversation_id": conversation_id,
                "disposition": "declined",
                "answer": "I can only answer questions about molecules, chemistry, biotechnology, and closely related biology. Try asking about a protein, compound, pathway, assay, or molecular mechanism.",
                "sources": [],
            }
        candidates = await asyncio.to_thread(search_europe_pmc, question)
        ranked = await asyncio.to_thread(rank_evidence, question, candidates, EMBED_MODEL, OLLAMA_HOST)
        if not ranked:
            return {
                "conversation_id": conversation_id,
                "disposition": "insufficient",
                "answer": "I could not find enough citable biomedical evidence for that question. Try naming the molecule, organism, pathway, or experimental method more precisely.",
                "sources": [],
            }
        answer, cited_indexes = await asyncio.to_thread(answer_from_evidence, question, ranked, CHAT_MODEL, OLLAMA_HOST, history)
        if not answer or not cited_indexes:
            return {
                "conversation_id": conversation_id,
                "disposition": "insufficient",
                "answer": answer or "Relevant literature was found, but the local model did not produce a verifiable cited answer. Try making the question more specific.",
                "sources": [],
            }
        sources = [ranked[index].public(f"S{index + 1}") for index in cited_indexes]
        for source in sources:
            source_cache[source["id"]] = source
        conversations[conversation_id].append({"role": "user", "content": question})
        conversations[conversation_id].append({"role": "assistant", "content": answer})
        return {"conversation_id": conversation_id, "disposition": "answered", "answer": answer, "sources": sources}
    except RagError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/sources/{source_id}")
async def source(source_id: str) -> dict[str, Any]:
    if source_id not in source_cache:
        raise HTTPException(status_code=404, detail="Source is not available in this assistant session.")
    return source_cache[source_id]
