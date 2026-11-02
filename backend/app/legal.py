from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()
CONTACT = "aryaarchie43@gmail.com"
UPDATED = "November 2, 2026"
STYLE = """<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#0f172a}
h1{font-size:2rem}h2{margin-top:2rem;font-size:1.2rem}a{color:#4f46e5}code{background:#f1f5f9;padding:1px 4px;border-radius:4px}
@media(prefers-color-scheme:dark){body{background:#020617;color:#e2e8f0}code{background:#1e293b}}</style>"""


def page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · Inbox Triage Coach</title>{STYLE}</head><body><p><a href="/">← Inbox Triage Coach</a></p><h1>{title}</h1>
<p><em>Last updated: {UPDATED}</em></p>{body}<hr><p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> · Contact: <a href="mailto:{CONTACT}">{CONTACT}</a></p></body></html>""")


PRIVACY = f"""
<p>Inbox Triage Coach ("the Service", "we") at <a href="https://inbox-triage-coach.fly.dev">inbox-triage-coach.fly.dev</a> helps you prioritize email threads and write reply drafts. This policy explains what data we access, how we use it, and your choices.</p>
<h2>1. Data we access</h2>
<ul>
<li><b>Google account email address</b> (scopes <code>openid</code>, <code>email</code>): to show which account is connected.</li>
<li><b>Gmail messages, read-only</b> (<code>https://www.googleapis.com/auth/gmail.readonly</code>): to list your inbox threads (subject, sender, date, snippet) and, only for threads you explicitly select, read their content so they can be triaged.</li>
<li><b>Gmail drafts</b> (<code>https://www.googleapis.com/auth/gmail.compose</code>): used <b>only</b> to create a draft reply in your Gmail when you click “Save as Gmail draft”. The Service <b>never sends email</b> on your behalf and never deletes or modifies existing messages.</li>
<li><b>Text you paste or upload</b> (fallback mode): processed the same way as selected threads.</li>
</ul>
<h2>2. How we use it</h2>
<p>The content of threads you select is sent from our server to Google’s Gemini API to produce a priority, summary, action list and reply drafts, and the result is returned to your browser. We use your data solely to provide these user-facing features.</p>
<h2>3. Storage and retention</h2>
<ul>
<li>We do <b>not</b> store your emails, triage results or drafts on our servers. There is no database.</li>
<li>Your Google OAuth tokens are kept only in an encrypted, HttpOnly cookie in your browser so you stay connected. They are deleted when you click “Disconnect” (which also revokes access with Google) or when the cookie expires (30 days).</li>
<li>Triage history is stored only in your own browser (localStorage). You can export or clear it anytime from the History page.</li>
<li>Standard server logs (IP address, request path, timestamp) may be kept briefly by our hosting provider (Fly.io) for security and reliability. They do not contain email content.</li>
</ul>
<h2>4. Sharing</h2>
<p>We do not sell, rent or trade your data, and we do not use it for advertising. Data is shared only with the processors needed to run the Service: Google (Gmail API, Gemini API) and Fly.io (hosting). Google’s processing is governed by Google’s own terms and privacy policy.</p>
<h2>5. Google API Services User Data Policy</h2>
<p>Inbox Triage Coach’s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. We do not use Gmail data to develop, improve or train generalized AI/ML models, and humans do not read your Gmail data except with your explicit consent (for example, for a support request you send us), for security purposes, or to comply with law.</p>
<h2>6. Your choices</h2>
<ul>
<li>Disconnect at any time in the app, or revoke access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</li>
<li>Clear local history from the History page or your browser settings.</li>
<li>Request deletion or ask questions by emailing <a href="mailto:{CONTACT}">{CONTACT}</a>.</li>
</ul>
<h2>7. Security</h2>
<p>All traffic uses HTTPS. Tokens are encrypted at rest in the cookie, and API keys for AI providers are held only on the server.</p>
<h2>8. Children</h2><p>The Service is not intended for children under 13 (or the minimum age in your country).</p>
<h2>9. Changes</h2><p>We will update this page and the “Last updated” date if this policy changes.</p>
"""

TERMS = f"""
<p>By using Inbox Triage Coach at <a href="https://inbox-triage-coach.fly.dev">inbox-triage-coach.fly.dev</a> (the “Service”) you agree to these terms.</p>
<h2>1. The Service</h2><p>The Service analyzes email threads you choose and suggests priorities, action items and reply drafts using AI. It is provided free of charge, “as is”, and may change or be discontinued at any time.</p>
<h2>2. Your account and data</h2><p>You connect your own Google account and remain responsible for it. You may only process email you are entitled to access. You can disconnect at any time. See our <a href="/privacy">Privacy Policy</a> for how data is handled.</p>
<h2>3. AI output</h2><p>Triage results and drafts are generated by AI and can be wrong or incomplete. Review every draft before sending it. The Service never sends email for you; you are responsible for anything you send.</p>
<h2>4. Acceptable use</h2><p>Do not misuse the Service: no spam, harassment, unlawful content, attempts to break security, scraping, or excessive automated use. We may rate-limit or block abusive use.</p>
<h2>5. Third-party services</h2><p>The Service relies on Google (Gmail, Gemini) and Fly.io. Their terms also apply to your use of those services.</p>
<h2>6. Disclaimer and liability</h2><p>To the maximum extent permitted by law, the Service is provided without warranties of any kind, and we are not liable for any indirect, incidental or consequential damages, lost data, or missed deadlines arising from its use.</p>
<h2>7. Open source</h2><p>The source code is available under the MIT License at <a href="https://github.com/archie-arya/inbox-triage-coach">github.com/archie-arya/inbox-triage-coach</a>.</p>
<h2>8. Changes and contact</h2><p>We may update these terms by posting a new version here. Questions: <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""


@router.get("/privacy", include_in_schema=False)
@router.get("/privacy/", include_in_schema=False)
async def privacy():
    return page("Privacy Policy", PRIVACY)


@router.get("/terms", include_in_schema=False)
@router.get("/terms/", include_in_schema=False)
async def terms():
    return page("Terms of Service", TERMS)
