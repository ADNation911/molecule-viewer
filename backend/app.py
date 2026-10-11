from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections import OrderedDict, defaultdict, deque
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .rag import (
    CloudflareProvider,
    OLLAMA_URL,
    OllamaProvider,
    RagError,
    answer_from_evidence,
    classify_scope,
    rank_evidence,
    search_europe_pmc,
)


PROVIDER_KIND = os.getenv("MOLECULE3D_INFERENCE_PROVIDER", "ollama").strip().lower()
if PROVIDER_KIND == "cloudflare":
    CHAT_MODEL = os.getenv("MOLECULE3D_CHAT_MODEL", "@cf/meta/llama-3.1-8b-instruct")
    EMBED_MODEL = os.getenv("MOLECULE3D_EMBED_MODEL", "@cf/baai/bge-base-en-v1.5")
    provider = CloudflareProvider(
        os.getenv("CLOUDFLARE_ACCOUNT_ID", ""),
        os.getenv("CLOUDFLARE_API_TOKEN", ""),
        CHAT_MODEL,
        EMBED_MODEL,
    )
elif PROVIDER_KIND == "ollama":
    CHAT_MODEL = os.getenv("MOLECULE3D_CHAT_MODEL", "qwen3:4b")
    EMBED_MODEL = os.getenv("MOLECULE3D_EMBED_MODEL", "nomic-embed-text")
    OLLAMA_HOST = os.getenv("OLLAMA_HOST", OLLAMA_URL)
    if not OLLAMA_HOST.startswith(("http://", "https://")):
        OLLAMA_HOST = f"http://{OLLAMA_HOST}"
    provider = OllamaProvider(CHAT_MODEL, EMBED_MODEL, OLLAMA_HOST)
else:
    raise RuntimeError("MOLECULE3D_INFERENCE_PROVIDER must be 'ollama' or 'cloudflare'.")

DEFAULT_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173,https://adnation911.github.io"
ALLOWED_ORIGINS = [origin.strip().rstrip("/") for origin in os.getenv("MOLECULE3D_ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if origin.strip()]
RATE_LIMIT_PER_MINUTE = max(1, int(os.getenv("MOLECULE3D_RATE_LIMIT", "10")))
MAX_HISTORY = 6
MAX_CONVERSATIONS = max(10, int(os.getenv("MOLECULE3D_MAX_CONVERSATIONS", "500")))
MAX_CACHED_SOURCES = max(50, int(os.getenv("MOLECULE3D_MAX_CACHED_SOURCES", "1000")))

app = FastAPI(title="Molecule3D RAG", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ChatRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1200)
    conversation_id: str | None = Field(default=None, max_length=80)


conversations: OrderedDict[str, deque[dict[str, str]]] = OrderedDict()
source_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
requests_by_ip: dict[str, deque[float]] = defaultdict(deque)


def _conversation(conversation_id: str) -> deque[dict[str, str]]:
    history = conversations.pop(conversation_id, None)
    if history is None:
        history = deque(maxlen=MAX_HISTORY)
    conversations[conversation_id] = history
    while len(conversations) > MAX_CONVERSATIONS:
        conversations.popitem(last=False)
    return history


def _cache_source(source: dict[str, Any]) -> None:
    source_cache.pop(source["id"], None)
    source_cache[source["id"]] = source
    while len(source_cache) > MAX_CACHED_SOURCES:
        source_cache.popitem(last=False)


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    window = requests_by_ip[ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Please wait a moment before asking another question.")
    window.append(now)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    try:
        result = await asyncio.to_thread(provider.health)
    except RagError as error:
        return {"status": "unavailable", "detail": str(error), "provider": provider.name, "chat_model": CHAT_MODEL, "embed_model": EMBED_MODEL}
    return {
        **result,
        "provider": provider.name,
        "chat_model": CHAT_MODEL,
        "embed_model": EMBED_MODEL,
    }


@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request) -> dict[str, Any]:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    _check_rate_limit(forwarded or (request.client.host if request.client else "local"))
    question = " ".join(payload.question.split())
    conversation_id = payload.conversation_id or str(uuid.uuid4())
    conversation = _conversation(conversation_id)
    history = list(conversation)
    try:
        in_scope = await asyncio.to_thread(classify_scope, question, provider)
        if not in_scope:
            return {
                "conversation_id": conversation_id,
                "disposition": "declined",
                "answer": "I can only answer questions about molecules, chemistry, biotechnology, and closely related biology. Try asking about a protein, compound, pathway, assay, or molecular mechanism.",
                "sources": [],
            }
        candidates = await asyncio.to_thread(search_europe_pmc, question)
        ranked = await asyncio.to_thread(rank_evidence, question, candidates, provider)
        if not ranked:
            return {
                "conversation_id": conversation_id,
                "disposition": "insufficient",
                "answer": "I could not find enough citable biomedical evidence for that question. Try naming the molecule, organism, pathway, or experimental method more precisely.",
                "sources": [],
            }
        answer, cited_indexes = await asyncio.to_thread(answer_from_evidence, question, ranked, provider, history)
        if not answer or not cited_indexes:
            return {
                "conversation_id": conversation_id,
                "disposition": "insufficient",
                "answer": answer or "Relevant literature was found, but the model did not produce a verifiable cited answer. Try making the question more specific.",
                "sources": [],
            }
        sources = [ranked[index].public(f"S{index + 1}") for index in cited_indexes]
        for source in sources:
            _cache_source(source)
        conversation.append({"role": "user", "content": question})
        conversation.append({"role": "assistant", "content": answer})
        return {"conversation_id": conversation_id, "disposition": "answered", "answer": answer, "sources": sources}
    except RagError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/api/sources/{source_id}")
async def source(source_id: str) -> dict[str, Any]:
    if source_id not in source_cache:
        raise HTTPException(status_code=404, detail="Source is not available in this assistant session.")
    return source_cache[source_id]


DIST_DIR = Path(__file__).resolve().parents[1] / "dist"
if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="site")
