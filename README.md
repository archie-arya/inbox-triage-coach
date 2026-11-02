# 📥 Inbox Triage & Reply Coach

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/archie-arya/inbox-triage-coach)

Paste (or upload) messy email / support threads → get **priority (P0–P3), category, sentiment, deadlines, an action list and human-sounding reply drafts** in seconds. Runs on free **Groq** or **Gemini** models, or fully local with **Ollama**.

## Features
- Triage: urgency P0–P3 with reason, category (billing/bug/sales/ops/personal/spam/fyi), sentiment, sender, deadline, actions (owner + due), risks
- Reply drafts in professional / warm / firm tones, with custom instructions; editable, copy, open-in-mail
- Batch mode (up to 10 threads, separated by a line of `=====`), `.eml`/`.txt` upload, sample threads
- History in localStorage with JSON/CSV export
- Settings: provider, model, temperature, max tokens. API keys stay server-side
- Dark/light mode, mobile-friendly, keyboard shortcuts (Ctrl/⌘+Enter), ARIA labels
- FastAPI backend: pydantic validation, structured errors, robust JSON parsing with retry, per-IP rate limit, CORS, health check, prompt-injection-aware prompts

## API
| Method | Path | Body |
|---|---|---|
| GET | `/api/health` | – |
| GET | `/api/providers` | – |
| POST | `/api/triage` | `{threads: string[], provider?, model?, temperature?, max_tokens?}` |
| POST | `/api/reply` | `{thread, tones: ["professional","warm","firm"], instructions?, triage?, provider?, model?}` |
| POST | `/api/parse-eml` | multipart `file` |

Interactive docs at `/docs`.

## Run locally
```bash
cp .env.example .env            # add GROQ_API_KEY and/or GEMINI_API_KEY
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..   # builds into backend/static
cd backend && ../.venv/bin/uvicorn app.main:app --reload --env-file ../.env
# open http://localhost:8000
```
Frontend dev with hot reload: `cd frontend && npm run dev` (proxies `/api` to :8000).

### Ollama (local, private)
```bash
ollama pull llama3.1
# .env: DEFAULT_PROVIDER=ollama  OLLAMA_BASE_URL=http://localhost:11434
```

## Docker
```bash
docker compose up --build    # http://localhost:8000
```

## Deploy (free)
Single container: FastAPI serves the built SPA, so one service = one public URL.
- **Render**: New → Blueprint → pick this repo (uses `render.yaml`). Set `GROQ_API_KEY` / `GEMINI_API_KEY`.
- **Railway**: `railway init && railway up`, then add the env vars. The Dockerfile is detected automatically, and `$PORT` is honored.
- **Fly.io**: `fly launch --dockerfile Dockerfile` then `fly secrets set GROQ_API_KEY=...`

## Env vars
`GROQ_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_BASE_URL`, `DEFAULT_PROVIDER` (groq|gemini|ollama), `DEFAULT_MODEL`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `MAX_INPUT_CHARS`.

## License
MIT
