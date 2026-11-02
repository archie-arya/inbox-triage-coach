"""Gmail OAuth (server-side web flow) + inbox/thread/draft endpoints.

Tokens are kept in an encrypted, HttpOnly cookie (Fernet, key derived from SESSION_SECRET),
so the server stays stateless and nothing is persisted in a database.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
import secrets
import time
from email.message import EmailMessage
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from .config import settings

router = APIRouter()
COOKIE = "itc_session"
SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
_secret = settings.session_secret or secrets.token_urlsafe(32)  # ephemeral if unset
_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(_secret.encode()).digest()))
SECURE = settings.public_url.startswith("https")


def configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def _redirect_uri() -> str:
    return settings.public_url.rstrip("/") + "/auth/google/callback"


def _read(req: Request) -> dict | None:
    c = req.cookies.get(COOKIE)
    if not c:
        return None
    try:
        return json.loads(_fernet.decrypt(c.encode()))
    except (InvalidToken, ValueError):
        return None


def _write(resp, data: dict) -> None:
    resp.set_cookie(COOKIE, _fernet.encrypt(json.dumps(data).encode()).decode(), httponly=True,
                    secure=SECURE, samesite="lax", max_age=60 * 60 * 24 * 30)


async def _token(req: Request) -> tuple[str, dict | None]:
    """Return a valid access token, refreshing if needed. Second item = updated session to re-set."""
    s = _read(req)
    if not s:
        raise HTTPException(401, "Connect your Gmail first")
    if s.get("exp", 0) > time.time() + 60:
        return s["at"], None
    if not s.get("rt"):
        raise HTTPException(401, "Gmail session expired — please reconnect")
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post("https://oauth2.googleapis.com/token", data={
            "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
            "refresh_token": s["rt"], "grant_type": "refresh_token"})
    if r.status_code != 200:
        raise HTTPException(401, "Gmail session expired — please reconnect")
    j = r.json()
    s.update(at=j["access_token"], exp=time.time() + j.get("expires_in", 3600))
    return s["at"], s


def _respond(data, updated: dict | None):
    resp = JSONResponse(data)
    if updated:
        _write(resp, updated)
    return resp


async def _gget(client: httpx.AsyncClient, at: str, path: str, **params):
    r = await client.get(f"{GMAIL}{path}", params=params, headers={"Authorization": f"Bearer {at}"})
    if r.status_code == 401:
        raise HTTPException(401, "Gmail session expired — please reconnect")
    if r.status_code >= 400:
        raise HTTPException(502, f"Gmail error {r.status_code}: {r.text[:200]}")
    return r.json()


@router.get("/auth/google/login")
async def login():
    if not configured():
        raise HTTPException(503, "Gmail sign-in is not configured on this server (GOOGLE_CLIENT_ID/SECRET)")
    state = secrets.token_urlsafe(16)
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": settings.google_client_id, "redirect_uri": _redirect_uri(), "response_type": "code",
        "scope": SCOPES, "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true", "state": state})
    resp = RedirectResponse(url)
    resp.set_cookie("itc_state", state, httponly=True, secure=SECURE, samesite="lax", max_age=600)
    return resp


@router.get("/auth/google/callback")
async def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error or not code or state != request.cookies.get("itc_state"):
        return RedirectResponse("/?auth_error=" + (error or "invalid_state"))
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
            "redirect_uri": _redirect_uri(), "grant_type": "authorization_code"})
        if r.status_code != 200:
            return RedirectResponse("/?auth_error=token_exchange_failed")
        j = r.json()
        prof = (await c.get(f"{GMAIL}/profile", headers={"Authorization": f"Bearer {j['access_token']}"})).json()
    resp = RedirectResponse("/#inbox")
    _write(resp, {"at": j["access_token"], "rt": j.get("refresh_token"),
                  "exp": time.time() + j.get("expires_in", 3600), "email": prof.get("emailAddress", "")})
    resp.delete_cookie("itc_state")
    return resp


@router.post("/auth/logout")
async def logout(request: Request):
    s = _read(request)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE)
    if s and s.get("rt"):
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                await c.post("https://oauth2.googleapis.com/revoke", params={"token": s["rt"]})
        except httpx.HTTPError:
            pass
    return resp


@router.get("/api/me")
async def me(request: Request):
    s = _read(request)
    return {"gmail_configured": configured(), "connected": bool(s), "email": (s or {}).get("email", "")}


def _hdr(headers: list[dict], name: str) -> str:
    return next((h["value"] for h in headers if h["name"].lower() == name.lower()), "")


@router.get("/api/gmail/threads")
async def list_threads(request: Request, q: str = "in:inbox", pageToken: str = "", max: int = 25):
    at, upd = await _token(request)
    async with httpx.AsyncClient(timeout=30) as c:
        params = {"q": q, "maxResults": min(max, 50)}
        if pageToken:
            params["pageToken"] = pageToken
        lst = await _gget(c, at, "/threads", **params)
        sem = asyncio.Semaphore(10)

        async def meta(tid: str):
            async with sem:
                t = await _gget(c, at, f"/threads/{tid}", format="metadata",
                                metadataHeaders=["Subject", "From", "Date"])
            msgs = t.get("messages", [])
            first, last = msgs[0], msgs[-1]
            return {"id": tid, "subject": _hdr(first["payload"].get("headers", []), "Subject") or "(no subject)",
                    "from": _hdr(last["payload"].get("headers", []), "From"),
                    "date": int(last.get("internalDate", 0)), "snippet": last.get("snippet", ""),
                    "count": len(msgs), "unread": any("UNREAD" in m.get("labelIds", []) for m in msgs)}

        threads = await asyncio.gather(*[meta(t["id"]) for t in lst.get("threads", [])])
    return _respond({"threads": threads, "nextPageToken": lst.get("nextPageToken")}, upd)


def _body(part: dict) -> str:
    mt, data = part.get("mimeType", ""), part.get("body", {}).get("data")
    if mt == "text/plain" and data:
        return base64.urlsafe_b64decode(data).decode("utf-8", "replace")
    subs = part.get("parts", [])
    for p in subs:
        if p.get("mimeType") == "text/plain":
            t = _body(p)
            if t:
                return t
    for p in subs:
        t = _body(p)
        if t:
            return t
    if mt == "text/html" and data:
        html = base64.urlsafe_b64decode(data).decode("utf-8", "replace")
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(style|script).*?</\1>", "", html)))
    return ""


def _strip_quotes(text: str) -> str:
    out = []
    for line in text.splitlines():
        if re.match(r"^On .+wrote:$", line.strip()):
            break
        if not line.startswith(">"):
            out.append(line)
    return "\n".join(out).strip()


@router.get("/api/gmail/threads/{tid}")
async def get_thread(tid: str, request: Request):
    at, upd = await _token(request)
    async with httpx.AsyncClient(timeout=30) as c:
        t = await _gget(c, at, f"/threads/{tid}", format="full")
    parts, last = [], {}
    for m in t.get("messages", []):
        h = m["payload"].get("headers", [])
        last = {"from": _hdr(h, "Reply-To") or _hdr(h, "From"), "subject": _hdr(h, "Subject"),
                "message_id": _hdr(h, "Message-ID"), "references": _hdr(h, "References")}
        parts.append(f"From: {_hdr(h, 'From')}\nTo: {_hdr(h, 'To')}\nDate: {_hdr(h, 'Date')}\n"
                     f"Subject: {_hdr(h, 'Subject')}\n\n{_strip_quotes(_body(m['payload']))[:8000]}")
    return _respond({"id": tid, "text": "\n\n-----\n\n".join(parts), "reply_meta": last}, upd)


class DraftIn(BaseModel):
    thread_id: str
    to: str
    subject: str
    body: str
    in_reply_to: str = ""
    references: str = ""


@router.post("/api/gmail/drafts")
async def create_draft(d: DraftIn, request: Request):
    at, upd = await _token(request)
    msg = EmailMessage()
    msg["To"] = d.to
    msg["Subject"] = d.subject if d.subject.lower().startswith("re:") else f"Re: {d.subject}"
    if d.in_reply_to:
        msg["In-Reply-To"] = d.in_reply_to
        msg["References"] = (d.references + " " + d.in_reply_to).strip()
    msg.set_content(d.body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{GMAIL}/drafts", headers={"Authorization": f"Bearer {at}"},
                         json={"message": {"raw": raw, "threadId": d.thread_id}})
    if r.status_code >= 400:
        raise HTTPException(502, f"Could not create Gmail draft: {r.text[:200]}")
    return _respond({"ok": True, "draft_id": r.json().get("id")}, upd)
