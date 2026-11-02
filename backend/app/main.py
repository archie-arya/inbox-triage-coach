from __future__ import annotations

import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from .config import settings
from .gmail import router as gmail_router
from .llm import LLMError, chat, provider_status
from .parsing import eml_to_text, extract_json
from .prompts import REPLY_SYSTEM, TONES, TRIAGE_SYSTEM

app = FastAPI(title="Inbox Triage & Reply Coach", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_credentials=settings.cors_origins != "*", allow_methods=["*"], allow_headers=["*"])

app.include_router(gmail_router)

_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path in ("/api/triage", "/api/reply"):
        ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0]
        now, q = time.time(), _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= settings.rate_limit_per_minute:
            return JSONResponse({"error": {"code": "rate_limited", "message": "Too many requests, slow down."}}, 429)
        q.append(now)
    return await call_next(request)


@app.exception_handler(LLMError)
async def llm_err(_: Request, e: LLMError):
    return JSONResponse({"error": {"code": "llm_error", "message": str(e)}}, e.status)


@app.exception_handler(HTTPException)
async def http_err(_: Request, e: HTTPException):
    return JSONResponse({"error": {"code": "http_error", "message": str(e.detail)}}, e.status_code)


class LLMOpts(BaseModel):
    provider: Literal["groq", "gemini", "ollama"] | None = None
    model: str | None = None
    temperature: float = Field(0.3, ge=0, le=2)
    max_tokens: int = Field(2048, ge=256, le=8192)


class Action(BaseModel):
    task: str
    owner: str = "me"
    due: str = ""


class Triage(BaseModel):
    subject: str = ""
    summary: str = ""
    priority: Literal["P0", "P1", "P2", "P3"] = "P2"
    priority_reason: str = ""
    category: str = "fyi"
    sentiment: str = "neutral"
    sender: str = ""
    deadline: str = ""
    requires_reply: bool = True
    actions: list[Action] = []
    risks: list[str] = []
    key_facts: list[str] = []


class TriageRequest(LLMOpts):
    threads: list[str] = Field(..., min_length=1, max_length=10)


class TriageResult(BaseModel):
    index: int
    ok: bool
    triage: Triage | None = None
    error: str | None = None


class ReplyRequest(LLMOpts):
    thread: str = Field(..., min_length=1)
    tones: list[Literal["professional", "warm", "firm"]] = ["professional", "warm"]
    instructions: str = ""
    triage: Triage | None = None


class Draft(BaseModel):
    tone: str
    subject: str = ""
    body: str


def _clip(t: str) -> str:
    if len(t) > settings.max_input_chars:
        raise HTTPException(413, f"Thread too long (max {settings.max_input_chars} chars)")
    return t


def _normalize(d: dict) -> Triage:
    d = {k: v for k, v in d.items() if v is not None}
    if isinstance(d.get("priority"), str):
        d["priority"] = d["priority"].upper()[:2] if d["priority"].upper()[:2] in ("P0", "P1", "P2", "P3") else "P2"
    acts = []
    for a in d.get("actions", []) or []:
        acts.append({"task": a} if isinstance(a, str) else {k: str(v) for k, v in a.items()})
    d["actions"] = acts
    return Triage.model_validate(d)


async def _triage_one(i: int, thread: str, o: LLMOpts) -> TriageResult:
    try:
        last = None
        for attempt in range(2):
            raw = await chat(o.provider, o.model, TRIAGE_SYSTEM, f"THREAD:\n<<<\n{_clip(thread)}\n>>>",
                             o.temperature if attempt == 0 else 0.0, o.max_tokens)
            try:
                return TriageResult(index=i, ok=True, triage=_normalize(extract_json(raw)))
            except (ValueError, ValidationError) as e:
                last = e
        return TriageResult(index=i, ok=False, error=f"Model returned invalid JSON: {last}")
    except LLMError as e:
        if e.status == 400:
            raise
        return TriageResult(index=i, ok=False, error=str(e))
    except HTTPException as e:
        return TriageResult(index=i, ok=False, error=str(e.detail))


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": app.version}


@app.get("/api/providers")
async def providers():
    return {"default_provider": settings.default_provider, "default_model": settings.default_model,
            "providers": provider_status()}


@app.post("/api/triage", response_model=list[TriageResult])
async def triage(req: TriageRequest):
    import asyncio
    return await asyncio.gather(*[_triage_one(i, t, req) for i, t in enumerate(req.threads) if t.strip()])


@app.post("/api/reply", response_model=list[Draft])
async def reply(req: ReplyRequest):
    tone_desc = "\n".join(f"- {t}: {TONES[t]}" for t in req.tones)
    ctx = f"Triage context: {req.triage.model_dump_json()}\n" if req.triage else ""
    user = (f"{ctx}Write one draft per tone:\n{tone_desc}\n"
            f"Extra instructions from me: {req.instructions or 'none'}\nTHREAD:\n<<<\n{_clip(req.thread)}\n>>>")
    raw = await chat(req.provider, req.model, REPLY_SYSTEM, user, req.temperature, req.max_tokens)
    try:
        data = extract_json(raw)
        drafts = data.get("drafts", data if isinstance(data, list) else [])
        return [Draft.model_validate(d) for d in drafts]
    except (ValueError, ValidationError, AttributeError):
        return [Draft(tone=req.tones[0], body=raw.strip())]


@app.post("/api/parse-eml")
async def parse_eml(file: UploadFile = File(...)):
    raw = await file.read()
    if len(raw) > 2_000_000:
        raise HTTPException(413, "File too large (2 MB max)")
    if file.filename and file.filename.lower().endswith(".eml"):
        return {"text": eml_to_text(raw)}
    return {"text": raw.decode("utf-8", errors="replace")}


STATIC = Path(__file__).resolve().parent.parent / "static"
if STATIC.exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        f = STATIC / path
        return FileResponse(f if path and f.is_file() else STATIC / "index.html")
