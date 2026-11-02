import email
import json
import re
from email import policy


def extract_json(text: str) -> dict:
    """Parse JSON from model output with fallbacks (fences, surrounding prose)."""
    if not text:
        raise ValueError("empty model output")
    t = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    start, end = t.find("{"), t.rfind("}")
    if start != -1 and end > start:
        chunk = t[start:end + 1]
        try:
            return json.loads(chunk)
        except json.JSONDecodeError:
            return json.loads(re.sub(r",\s*([}\]])", r"\1", chunk))
    raise ValueError("no JSON object in model output")


def eml_to_text(raw: bytes) -> str:
    msg = email.message_from_bytes(raw, policy=policy.default)
    head = "\n".join(f"{h}: {msg.get(h, '')}" for h in ("From", "To", "Date", "Subject") if msg.get(h))
    body = msg.get_body(preferencelist=("plain", "html"))
    content = body.get_content() if body else ""
    if body is not None and body.get_content_type() == "text/html":
        content = re.sub(r"<[^>]+>", " ", content)
    return f"{head}\n\n{content.strip()}"
