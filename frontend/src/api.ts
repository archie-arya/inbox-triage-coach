export type Action = { task: string; owner: string; due: string };
export type Triage = { subject: string; summary: string; priority: "P0"|"P1"|"P2"|"P3"; priority_reason: string; category: string;
  sentiment: string; sender: string; deadline: string; requires_reply: boolean; actions: Action[]; risks: string[]; key_facts: string[] };
export type TriageResult = { index: number; ok: boolean; triage?: Triage; error?: string };
export type Draft = { tone: string; subject: string; body: string };
export type Provider = { id: string; name: string; configured: boolean; models: string[] };
export type Settings = { provider: string; model: string; temperature: number; max_tokens: number };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || data?.detail?.[0]?.msg || `Request failed (${r.status})`);
  return data as T;
}
const post = <T,>(p: string, body: unknown) => req<T>(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const opts = (s: Settings) => ({ provider: s.provider, model: s.model || null, temperature: s.temperature, max_tokens: s.max_tokens });

export const api = {
  providers: () => req<{ default_provider: string; default_model: string; providers: Provider[] }>("/api/providers"),
  triage: (threads: string[], s: Settings) => post<TriageResult[]>("/api/triage", { threads, ...opts(s) }),
  reply: (thread: string, tones: string[], instructions: string, triage: Triage | undefined, s: Settings) =>
    post<Draft[]>("/api/reply", { thread, tones, instructions, triage, ...opts(s) }),
  parseFile: (f: File) => { const fd = new FormData(); fd.append("file", f); return req<{ text: string }>("/api/parse-eml", { method: "POST", body: fd }); },
};
