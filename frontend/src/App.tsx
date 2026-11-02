import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, Draft, gmail, Me, Provider, ReplyMeta, Settings, ThreadMeta, Triage, TriageResult } from "./api";
import { SAMPLES } from "./samples";

type GMeta = { thread_id: string } & ReplyMeta;
type HistoryItem = { id: string; at: string; thread: string; triage: Triage; drafts?: Draft[] };
type Toast = { id: number; msg: string; kind: "error" | "ok" };
const SEP = "\n=====\n";
const PCOLOR: Record<string, string> = {
  P0: "bg-red-600 text-white", P1: "bg-orange-500 text-white", P2: "bg-amber-300 text-slate-900", P3: "bg-slate-300 text-slate-900",
};
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) || "") ?? d; } catch { return d; } };

export default function App() {
  const [dark, setDark] = useState(() => load("itc.dark", window.matchMedia("(prefers-color-scheme: dark)").matches));
  const [view, setView] = useState<"home" | "inbox" | "app" | "history">(() => (location.hash === "#inbox" ? "inbox" : location.hash === "#app" ? "app" : "home"));
  const [me, setMe] = useState<Me | null>(null);
  const [inboxResults, setInboxResults] = useState<{ thread: string; meta: GMeta; r: TriageResult }[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [settings, setSettings] = useState<Settings>(() => load("itc.settings", { provider: "", model: "", temperature: 0.3, max_tokens: 2048 }));
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ thread: string; r: TriageResult }[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>(() => load("itc.history", []));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); localStorage.setItem("itc.dark", JSON.stringify(dark)); }, [dark]);
  useEffect(() => { localStorage.setItem("itc.settings", JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem("itc.history", JSON.stringify(history.slice(0, 200))); }, [history]);
  useEffect(() => {
    api.providers().then((p) => {
      setProviders(p.providers);
      setSettings((s) => (s.provider ? s : { ...s, provider: p.default_provider, model: p.default_model }));
    }).catch((e) => toast(e.message));
    gmail.me().then(setMe).catch(() => setMe({ gmail_configured: false, connected: false, email: "" }));
    const err = new URLSearchParams(location.search).get("auth_error");
    if (err) { toast(`Gmail sign-in failed: ${err}`); window.history.replaceState(null, "", "/"); }
  }, []);

  const toast = (msg: string, kind: Toast["kind"] = "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  };
  const threads = useMemo(() => input.split(/\n={5,}\n/).map((t) => t.trim()).filter(Boolean), [input]);

  async function runTriage() {
    if (!threads.length) return toast("Paste at least one thread first");
    setBusy(true); setResults([]);
    try {
      const res = await api.triage(threads, settings);
      const out = res.map((r) => ({ thread: threads[r.index], r }));
      setResults(out);
      const ok = out.filter((o) => o.r.ok && o.r.triage);
      setHistory((h) => [...ok.map((o) => ({ id: crypto.randomUUID(), at: new Date().toISOString(), thread: o.thread, triage: o.r.triage! })), ...h]);
      if (ok.length) toast(`Triaged ${ok.length} thread${ok.length > 1 ? "s" : ""}`, "ok");
      out.filter((o) => !o.r.ok).forEach((o) => toast(`Thread ${o.r.index + 1}: ${o.r.error}`));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    try {
      const texts = await Promise.all([...files].map((f) => api.parseFile(f).then((r) => r.text)));
      setInput((cur) => [cur.trim(), ...texts].filter(Boolean).join(SEP));
    } catch (e) { toast((e as Error).message); }
  }

  const sorted = [...results].sort((a, b) => (a.r.triage?.priority ?? "P9").localeCompare(b.r.triage?.priority ?? "P9"));
  const current = providers.find((p) => p.id === settings.provider);

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only">Skip to content</a>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button onClick={() => setView("home")} className="font-semibold">📥 Inbox Triage <span className="text-indigo-500">Coach</span></button>
          <nav className="ml-auto flex items-center gap-2 text-sm">
            <button className="btn-ghost" onClick={() => setView("inbox")} aria-current={view === "inbox"}>Inbox</button>
            <button className="btn-ghost hidden sm:inline-flex" onClick={() => setView("app")} aria-current={view === "app"}>Paste</button>
            <button className="btn-ghost" onClick={() => setView("history")}>History ({history.length})</button>
            <button className="btn-ghost" aria-label="Settings" onClick={() => setShowSettings(true)}>⚙️</button>
            <button className="btn-ghost" aria-label="Toggle dark mode" onClick={() => setDark(!dark)}>{dark ? "☀️" : "🌙"}</button>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        {view === "home" && <Landing me={me} onInbox={() => setView("inbox")} onSample={() => { setView("app"); setInput(SAMPLES.join(SEP)); }} />}

        {view === "inbox" && <Inbox me={me} setMe={setMe} settings={settings} toast={toast} results={inboxResults} setResults={setInboxResults}
          onSaved={(items) => setHistory((h) => [...items, ...h])} onPaste={() => setView("app")} />}

        {view === "app" && (
          <div className="grid gap-6 lg:grid-cols-5">
            <section className="card lg:col-span-2" aria-label="Input">
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="threads" className="font-medium">Threads</label>
                <span className="text-xs text-slate-500">{threads.length} thread(s) · separate with a line of =====</span>
              </div>
              <textarea id="threads" className="input h-80 font-mono text-xs" value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runTriage(); }}
                placeholder={"Paste one or more email/support threads…\n\n=====\n\nNext thread"} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy} onClick={runTriage}>{busy ? <Spinner /> : "⚡"} Triage {threads.length > 1 ? `${threads.length} threads` : ""}</button>
                <button className="btn-ghost" onClick={() => setInput(SAMPLES.join(SEP))}>Try sample</button>
                <button className="btn-ghost" onClick={() => fileRef.current?.click()}>Upload .eml/.txt</button>
                <button className="btn-ghost" onClick={() => { setInput(""); setResults([]); }}>Clear</button>
                <input ref={fileRef} type="file" accept=".eml,.txt,text/plain,message/rfc822" multiple hidden onChange={(e) => onFiles(e.target.files)} />
              </div>
              <p className="mt-3 text-xs text-slate-500">Using <b>{current?.name ?? settings.provider}</b>{settings.model ? ` · ${settings.model}` : ""} · Ctrl/⌘+Enter to run
                {current && !current.configured && <span className="text-red-500"> · not configured on server</span>}</p>
            </section>

            <section className="space-y-4 lg:col-span-3" aria-live="polite" aria-label="Results">
              {busy && [0, 1].map((i) => <div key={i} className="card h-40 animate-pulse" />)}
              {!busy && !results.length && (
                <div className="card text-center text-slate-500">
                  <p className="text-4xl">🗂️</p><p className="mt-2">Results appear here, sorted by priority.</p>
                  <p className="text-sm">No thread handy? Hit <b>Try sample</b>.</p>
                </div>)}
              {sorted.map(({ thread, r }) => r.ok && r.triage
                ? <TriageCard key={r.index} thread={thread} t={r.triage} settings={settings} toast={toast}
                    onDrafts={(d) => setHistory((h) => h.map((x) => (x.thread === thread ? { ...x, drafts: d } : x)))} />
                : <div key={r.index} className="card border-red-300 text-sm text-red-600">Thread {r.index + 1} failed: {r.error}</div>)}
            </section>
          </div>)}

        {view === "history" && <History items={history} setItems={setHistory} toast={toast} />}
      </main>

      {showSettings && <SettingsModal providers={providers} s={settings} set={setSettings} close={() => setShowSettings(false)} />}

      <div className="fixed bottom-4 right-4 z-50 space-y-2" role="status">
        {toasts.map((t) => <div key={t.id} className={`rounded-xl px-4 py-3 text-sm text-white shadow-lg ${t.kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}>{t.msg}</div>)}
      </div>
    </div>
  );
}

function Spinner() { return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />; }

function Landing({ me, onInbox, onSample }: { me: Me | null; onInbox: () => void; onSample: () => void }) {
  const feats = [
    ["🚦", "Priority in seconds", "P0–P3 urgency with the reason, so you know what to answer first."],
    ["✅", "Action list", "Who owes what, by when — deadlines extracted from the thread."],
    ["✍️", "Human drafts", "Professional, warm or firm replies that don't sound like a bot."],
    ["📦", "Batch + private", "Triage 10 threads at once. History stays in your browser. Run on Groq, Gemini or local Ollama."],
  ];
  return (
    <div className="py-10 text-center">
      <p className="mx-auto w-fit rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">Free models · Groq · Gemini · Ollama</p>
      <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">Stop drowning in email. <span className="text-indigo-500">Know what matters and reply faster.</span></h1>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-400">Connect Gmail, pick the threads that matter, and get urgency, category, sentiment, deadlines, a clear to-do list and ready-to-send reply drafts.</p>
      <div className="mt-8 flex justify-center gap-3">
        {me?.connected
          ? <button className="btn-primary px-6 py-3 text-base" onClick={onInbox}>Open my inbox →</button>
          : <a className="btn-primary px-6 py-3 text-base" href="/auth/google/login" aria-disabled={!me?.gmail_configured}><GIcon /> Connect Gmail</a>}
        <button className="btn-ghost px-6 py-3 text-base" onClick={onSample}>Try a sample (no sign-in)</button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Read + draft access only. We never send email for you and store nothing on our servers.</p>
      <div className="mt-12 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
        {feats.map(([i, h, d]) => <div key={h} className="card"><div className="text-2xl">{i}</div><h3 className="mt-2 font-semibold">{h}</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{d}</p></div>)}
      </div>
    </div>);
}

function TriageCard({ thread, t, settings, toast, onDrafts, meta }: { thread: string; t: Triage; settings: Settings; toast: (m: string, k?: "ok" | "error") => void; onDrafts: (d: Draft[]) => void; meta?: GMeta }) {
  const [tones, setTones] = useState<string[]>(["professional", "warm"]);
  const [instr, setInstr] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  async function gen() {
    if (!tones.length) return toast("Pick at least one tone");
    setBusy(true);
    try { const d = await api.reply(thread, tones, instr, t, settings); setDrafts(d); onDrafts(d); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <article className="card">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${PCOLOR[t.priority]}`}>{t.priority}</span>
        <Badge>{t.category}</Badge><Badge>{sentimentEmoji(t.sentiment)} {t.sentiment}</Badge>
        {t.deadline && <Badge>⏰ {t.deadline}</Badge>}
        {!t.requires_reply && <Badge>no reply needed</Badge>}
      </div>
      <h2 className="mt-3 text-lg font-semibold">{t.subject || "Untitled thread"}</h2>
      {t.sender && <p className="text-xs text-slate-500">From {t.sender}</p>}
      <p className="mt-2 text-sm">{t.summary}</p>
      <p className="mt-1 text-xs italic text-slate-500">Why {t.priority}: {t.priority_reason}</p>
      {t.actions.length > 0 && <div className="mt-4"><h3 className="text-sm font-semibold">Actions</h3>
        <ul className="mt-1 space-y-1 text-sm">{t.actions.map((a, i) => <li key={i} className="flex gap-2"><input type="checkbox" aria-label={a.task} /> <span>{a.task} <span className="text-xs text-slate-500">· {a.owner}{a.due ? ` · ${a.due}` : ""}</span></span></li>)}</ul></div>}
      {t.risks.length > 0 && <div className="mt-3 text-sm"><h3 className="font-semibold">Risks</h3><ul className="list-disc pl-5 text-red-600 dark:text-red-400">{t.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        <fieldset className="flex flex-wrap items-center gap-3 text-sm"><legend className="sr-only">Tones</legend>
          {["professional", "warm", "firm"].map((x) => <label key={x} className="flex items-center gap-1"><input type="checkbox" checked={tones.includes(x)} onChange={() => setTones(tones.includes(x) ? tones.filter((y) => y !== x) : [...tones, x])} />{x}</label>)}
        </fieldset>
        <input className="input mt-2" placeholder="Optional: e.g. offer a 10% credit, propose Wednesday 3pm" value={instr} onChange={(e) => setInstr(e.target.value)} aria-label="Reply instructions" />
        <button className="btn-primary mt-2" disabled={busy} onClick={gen}>{busy ? <Spinner /> : "✍️"} {drafts.length ? "Regenerate" : "Draft replies"}</button>
        <div className="mt-3 grid gap-3 md:grid-cols-2">{drafts.map((d, i) => <DraftBox key={i} d={d} toast={toast} meta={meta} />)}</div>
      </div>
    </article>);
}

function DraftBox({ d, toast, meta }: { d: Draft; toast: (m: string, k?: "ok" | "error") => void; meta?: GMeta }) {
  const [body, setBody] = useState(d.body);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!meta) return;
    setSaving(true);
    try { await gmail.draft({ thread_id: meta.thread_id, to: meta.from, subject: meta.subject, body, in_reply_to: meta.message_id, references: meta.references }); toast("Saved to Gmail drafts", "ok"); }
    catch (e) { toast((e as Error).message); } finally { setSaving(false); }
  };
  useEffect(() => setBody(d.body), [d.body]);
  const copy = async () => { await navigator.clipboard.writeText((d.subject ? `Subject: ${d.subject}\n\n` : "") + body); toast("Copied to clipboard", "ok"); };
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="mb-2 flex items-center justify-between"><Badge>{d.tone}</Badge>
        <div className="flex gap-1">{meta && <button className="btn-primary px-2 py-1 text-xs" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save as Gmail draft"}</button>}<button className="btn-ghost px-2 py-1 text-xs" onClick={copy}>Copy</button>
          <a className="btn-ghost px-2 py-1 text-xs" href={`mailto:?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(body)}`}>Open in mail</a></div></div>
      {d.subject && <p className="mb-1 text-xs font-medium">Subject: {d.subject}</p>}
      <textarea className="input h-48 text-sm" value={body} onChange={(e) => setBody(e.target.value)} aria-label={`${d.tone} draft`} />
    </div>);
}

function History({ items, setItems, toast }: { items: HistoryItem[]; setItems: (h: HistoryItem[]) => void; toast: (m: string, k?: "ok" | "error") => void }) {
  const dl = (name: string, data: string, type: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); };
  const csv = () => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = items.map((h) => [h.at, h.triage.priority, h.triage.category, h.triage.sentiment, h.triage.subject, h.triage.sender, h.triage.deadline, h.triage.summary, h.triage.actions.map((a) => a.task).join(" | ")].map(esc).join(","));
    dl("triage-history.csv", ["at,priority,category,sentiment,subject,sender,deadline,summary,actions", ...rows].join("\n"), "text/csv");
  };
  if (!items.length) return <div className="card text-center text-slate-500"><p className="text-4xl">🕰️</p><p className="mt-2">No history yet. Triaged threads are saved in this browser only.</p></div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => dl("triage-history.json", JSON.stringify(items, null, 2), "application/json")}>Export JSON</button>
        <button className="btn-ghost" onClick={csv}>Export CSV</button>
        <button className="btn-ghost text-red-600" onClick={() => { if (confirm("Clear all history?")) { setItems([]); toast("History cleared", "ok"); } }}>Clear history</button>
      </div>
      {items.map((h) => (
        <details key={h.id} className="card">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2">
            <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${PCOLOR[h.triage.priority]}`}>{h.triage.priority}</span>
            <span className="font-medium">{h.triage.subject}</span><Badge>{h.triage.category}</Badge>
            <span className="ml-auto text-xs text-slate-500">{new Date(h.at).toLocaleString()}</span>
          </summary>
          <p className="mt-2 text-sm">{h.triage.summary}</p>
          {h.drafts?.map((d, i) => <pre key={i} className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-100 p-2 text-xs dark:bg-slate-800"><b>{d.tone}</b>{"\n"}{d.body}</pre>)}
        </details>))}
    </div>);
}

function SettingsModal({ providers, s, set, close }: { providers: Provider[]; s: Settings; set: (s: Settings) => void; close: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && close(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [close]);
  const p = providers.find((x) => x.id === s.provider);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="st" className="card w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 id="st" className="text-lg font-semibold">Settings</h2>
        <label className="block text-sm">Provider
          <select className="input mt-1" value={s.provider} onChange={(e) => set({ ...s, provider: e.target.value, model: "" })} autoFocus>
            {providers.map((x) => <option key={x.id} value={x.id}>{x.name}{x.configured ? "" : " (not configured)"}</option>)}
          </select></label>
        <label className="block text-sm">Model
          <input className="input mt-1" list="models" value={s.model} placeholder={p?.models[0] ?? "default"} onChange={(e) => set({ ...s, model: e.target.value })} />
          <datalist id="models">{p?.models.map((m) => <option key={m} value={m} />)}</datalist></label>
        <label className="block text-sm">Temperature: {s.temperature}
          <input type="range" min={0} max={1.5} step={0.1} className="w-full" value={s.temperature} onChange={(e) => set({ ...s, temperature: +e.target.value })} /></label>
        <label className="block text-sm">Max tokens
          <input type="number" min={256} max={8192} step={256} className="input mt-1" value={s.max_tokens} onChange={(e) => set({ ...s, max_tokens: +e.target.value })} /></label>
        <p className="text-xs text-slate-500">API keys live on the server (env vars), never in your browser.</p>
        <button className="btn-primary w-full justify-center" onClick={close}>Done</button>
      </div>
    </div>);
}

function Badge({ children }: { children: React.ReactNode }) { return <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{children}</span>; }
function sentimentEmoji(s: string) { return ({ angry: "😡", frustrated: "😤", positive: "😊" } as Record<string, string>)[s] ?? "😐"; }

function GIcon() { return <span aria-hidden className="rounded bg-white px-1 text-xs font-bold text-red-500">M</span>; }

function Inbox({ me, setMe, settings, toast, results, setResults, onSaved, onPaste }: {
  me: Me | null; setMe: (m: Me) => void; settings: Settings; toast: (m: string, k?: "ok" | "error") => void;
  results: { thread: string; meta: GMeta; r: TriageResult }[]; setResults: (r: { thread: string; meta: GMeta; r: TriageResult }[]) => void;
  onSaved: (h: HistoryItem[]) => void; onPaste: () => void }) {
  const [q, setQ] = useState("in:inbox");
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async (more = false) => {
    setLoading(true);
    try { const r = await gmail.list(q, more ? next ?? "" : ""); setThreads(more ? [...threads, ...r.threads] : r.threads); setNext(r.nextPageToken); }
    catch (e) { toast((e as Error).message); if (String((e as Error).message).includes("reconnect")) setMe({ ...me!, connected: false }); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (me?.connected) load(); }, [me?.connected]);
  if (!me) return <div className="card h-40 animate-pulse" />;
  if (!me.connected) return (
    <div className="card mx-auto max-w-lg text-center">
      <p className="text-4xl">📬</p><h2 className="mt-2 text-xl font-semibold">Connect your Gmail</h2>
      <p className="mt-2 text-sm text-slate-500">Pick threads from your inbox and get priorities + reply drafts. Read and draft access only. Nothing is sent without you.</p>
      {me.gmail_configured
        ? <a className="btn-primary mt-4" href="/auth/google/login"><GIcon /> Sign in with Google</a>
        : <p className="mt-4 text-sm text-amber-600">Gmail sign-in isn't configured on this server yet.</p>}
      <p className="mt-4 text-sm"><button className="underline" onClick={onPaste}>Or paste / upload a thread instead</button></p>
    </div>);
  async function triageSelected() {
    const ids = [...sel].slice(0, 10);
    if (!ids.length) return toast("Select at least one thread");
    setBusy(true); setResults([]);
    try {
      const full = await Promise.all(ids.map((id) => gmail.thread(id)));
      const res = await api.triage(full.map((f) => f.text), settings);
      const out = res.map((r) => ({ thread: full[r.index].text, meta: { thread_id: full[r.index].id, ...full[r.index].reply_meta }, r }));
      setResults(out);
      onSaved(out.filter((o) => o.r.ok && o.r.triage).map((o) => ({ id: crypto.randomUUID(), at: new Date().toISOString(), thread: o.thread, triage: o.r.triage! })));
      out.filter((o) => !o.r.ok).forEach((o) => toast(`Thread ${o.r.index + 1}: ${o.r.error}`));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  const toggle = (id: string) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.size < 10 ? s.add(id) : toast("Max 10 threads per batch"); setSel(s); };
  const sorted = [...results].sort((a, b) => (a.r.triage?.priority ?? "P9").localeCompare(b.r.triage?.priority ?? "P9"));
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section className="card lg:col-span-2" aria-label="Inbox">
        <div className="flex items-center justify-between text-sm"><span className="truncate text-slate-500">{me.email}</span>
          <button className="text-xs underline" onClick={async () => { await gmail.logout(); setMe({ ...me, connected: false, email: "" }); }}>Disconnect</button></div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Gmail search" placeholder="in:inbox is:unread" />
          <button className="btn-ghost">Search</button></form>
        <div className="mt-2 flex flex-wrap gap-1 text-xs">{["in:inbox", "is:unread", "is:important", "newer_than:2d"].map((x) =>
          <button key={x} className="rounded-lg bg-slate-100 px-2 py-1 dark:bg-slate-800" onClick={() => { setQ(x); setTimeout(() => load(), 0); }}>{x}</button>)}</div>
        <ul className="mt-3 max-h-[60vh] divide-y divide-slate-200 overflow-auto dark:divide-slate-800">
          {threads.map((t) => (
            <li key={t.id}><label className="flex cursor-pointer gap-3 py-2">
              <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} className="mt-1" />
              <span className="min-w-0"><span className={`block truncate text-sm ${t.unread ? "font-semibold" : ""}`}>{t.subject}{t.count > 1 ? ` (${t.count})` : ""}</span>
                <span className="block truncate text-xs text-slate-500">{t.from.replace(/<.*>/, "")} · {new Date(t.date).toLocaleDateString()}</span>
                <span className="block truncate text-xs text-slate-400">{t.snippet}</span></span></label></li>))}
          {loading && <li className="py-3 text-center text-sm text-slate-500">Loading…</li>}
          {!loading && !threads.length && <li className="py-6 text-center text-sm text-slate-500">No threads match.</li>}
        </ul>
        {next && !loading && <button className="btn-ghost mt-2 w-full justify-center" onClick={() => load(true)}>Load more</button>}
        <button className="btn-primary mt-3 w-full justify-center" disabled={busy || !sel.size} onClick={triageSelected}>{busy ? <Spinner /> : "⚡"} Triage {sel.size || ""} selected</button>
      </section>
      <section className="space-y-4 lg:col-span-3" aria-live="polite">
        {busy && [0, 1].map((i) => <div key={i} className="card h-40 animate-pulse" />)}
        {!busy && !results.length && <div className="card text-center text-slate-500"><p className="text-4xl">🗂️</p><p className="mt-2">Select threads on the left and hit <b>Triage</b>.</p></div>}
        {sorted.map(({ thread, meta, r }) => r.ok && r.triage
          ? <TriageCard key={r.index} thread={thread} t={r.triage} settings={settings} toast={toast} meta={meta} onDrafts={() => {}} />
          : <div key={r.index} className="card text-sm text-red-600">Thread {r.index + 1} failed: {r.error}</div>)}
      </section>
    </div>);
}
