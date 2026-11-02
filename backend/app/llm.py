"""Provider abstraction: Groq (OpenAI-compatible), Gemini, Ollama."""
from __future__ import annotations

import httpx

from .config import settings

DEFAULT_MODELS = {
    "groq": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-20b"],
    "gemini": ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"],
    "ollama": ["llama3.1", "qwen2.5", "mistral"],
}


class LLMError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def provider_status() -> list[dict]:
    return [
        {"id": "groq", "name": "Groq", "configured": bool(settings.groq_api_key), "models": DEFAULT_MODELS["groq"]},
        {"id": "gemini", "name": "Google Gemini", "configured": bool(settings.gemini_api_key), "models": DEFAULT_MODELS["gemini"]},
        {"id": "ollama", "name": "Ollama (local)", "configured": bool(settings.ollama_base_url), "models": DEFAULT_MODELS["ollama"]},
    ]


async def chat(provider: str, model: str | None, system: str, user: str,
               temperature: float = 0.3, max_tokens: int = 2048, json_mode: bool = True) -> str:
    """Call the provider; if no explicit model was chosen, fall back through the model list on 404/429/5xx."""
    explicit = model or settings.default_model
    p = (provider or settings.default_provider).lower()
    candidates = [explicit] if explicit else DEFAULT_MODELS.get(p, [None])[:3]
    last: LLMError | None = None
    for m in candidates:
        try:
            return await _chat(p, m, system, user, temperature, max_tokens, json_mode)
        except LLMError as e:
            last = e
            if e.status == 400 or explicit:
                raise
    raise last  # type: ignore[misc]


async def _chat(provider: str, model: str | None, system: str, user: str,
               temperature: float = 0.3, max_tokens: int = 2048, json_mode: bool = True) -> str:
    provider = (provider or settings.default_provider).lower()
    if provider not in DEFAULT_MODELS:
        raise LLMError(f"Unknown provider '{provider}'", 400)
    model = model or settings.default_model or DEFAULT_MODELS[provider][0]
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout) as client:
            if provider == "groq":
                if not settings.groq_api_key:
                    raise LLMError("GROQ_API_KEY is not configured on the server", 400)
                body = {"model": model, "temperature": temperature, "max_tokens": max_tokens,
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
                if json_mode:
                    body["response_format"] = {"type": "json_object"}
                r = await client.post("https://api.groq.com/openai/v1/chat/completions",
                                      headers={"Authorization": f"Bearer {settings.groq_api_key}"}, json=body)
                _check(r, "Groq")
                return r.json()["choices"][0]["message"]["content"]
            if provider == "gemini":
                if not settings.gemini_api_key:
                    raise LLMError("GEMINI_API_KEY is not configured on the server", 400)
                cfg = {"temperature": temperature, "maxOutputTokens": max_tokens}
                if model.startswith("gemini-2.5-flash"):
                    cfg["thinkingConfig"] = {"thinkingBudget": 0}  # keep latency low, tokens for output
                if json_mode:
                    cfg["responseMimeType"] = "application/json"
                body = {"systemInstruction": {"parts": [{"text": system}]},
                        "contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": cfg}
                r = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    headers={"x-goog-api-key": settings.gemini_api_key}, json=body)
                _check(r, "Gemini")
                parts = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [])
                return "".join(p.get("text", "") for p in parts)
            # ollama native
            body = {"model": model, "stream": False,
                    "options": {"temperature": temperature, "num_predict": max_tokens},
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
            if json_mode:
                body["format"] = "json"
            r = await client.post(f"{settings.ollama_base_url.rstrip('/')}/api/chat", json=body)
            _check(r, "Ollama")
            return r.json()["message"]["content"]
    except httpx.TimeoutException:
        raise LLMError(f"{provider} timed out", 504)
    except httpx.HTTPError as e:
        raise LLMError(f"Could not reach {provider}: {e}", 502)


def _check(r: httpx.Response, name: str) -> None:
    if r.status_code == 429:
        raise LLMError(f"{name} rate limit hit — wait a moment and retry", 429)
    if r.status_code in (404, 500, 503):
        raise LLMError(f"{name} model unavailable ({r.status_code}): {r.text[:200]}", 503)
    if r.status_code >= 400:
        raise LLMError(f"{name} error {r.status_code}: {r.text[:300]}", 502)
