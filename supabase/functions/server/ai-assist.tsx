/**
 * ai-assist.tsx
 *
 * Server-side AI proxy for the in-app incident-report assistant. Exposes a
 * single Hono router mounted at `/make-server-64775d98/ai-assist` by the
 * function entrypoint. The provider/model are selected by env vars so we
 * can swap Anthropic ⇄ OpenAI (or future providers) without a code change.
 *
 * Endpoint: POST /make-server-64775d98/ai-assist
 *   body: {
 *     action: 'polish' | 'expand' | 'customer_rewrite' | 'review',
 *     field?: string,                // required for non-review actions
 *     text?: string,                 // required for non-review actions
 *     incident?: Record<string, any> // required for review
 *   }
 *
 * Response shape:
 *   polish/expand/customer_rewrite → { result: string }
 *   review                         → { findings: ReviewFinding[] }
 *   any failure                    → { error: string }, HTTP 4xx/5xx
 *
 * The provider API key NEVER leaves the function. Configure in Supabase
 * secrets:
 *
 *   supabase secrets set AI_PROVIDER=anthropic \
 *                        AI_MODEL=claude-sonnet-4-6 \
 *                        ANTHROPIC_API_KEY=sk-ant-...
 *
 * Prompts here are duplicated from src/app/lib/aiAssistantCore.ts because
 * Deno Edge Functions cannot import files outside the function folder. The
 * frontend copy is what gets unit-tested; if you edit one, update the other.
 */

import { Hono } from 'npm:hono';
import { requireUser } from './auth-helpers.tsx';

// ── Types ───────────────────────────────────────────────────────────────────

type AIAction = 'polish' | 'expand' | 'customer_rewrite' | 'review';

interface ReviewFinding {
  severity: 'high' | 'medium' | 'low';
  field: string;
  issue: string;
  suggestion: string;
}

// ── Limits ──────────────────────────────────────────────────────────────────

const MAX_FIELD_CHARS = 8000;
const MAX_INCIDENT_CHARS = 32000;
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

const ASSISTANT_FIELDS = [
  'incident_description',
  'investigation',
  'root_cause',
  'corrective_action',
  'preventive_action',
  'notes',
] as const;

const FIELD_LABELS: Record<string, string> = {
  incident_description: 'Incident Description',
  investigation: 'Investigation',
  root_cause: 'Root Cause',
  corrective_action: 'Corrective Action',
  preventive_action: 'Preventive Action',
  notes: 'Notes',
};

// ── Prompts (mirror aiAssistantCore.ts) ─────────────────────────────────────

const STYLE_GUIDE = `
Voice: neutral, factual, technical incident-report English used by an oil &
gas field-service quality manager. Past tense for events that happened.
Avoid speculation, hedging ("perhaps", "maybe"), filler ("essentially"), or
marketing language. Never invent facts that aren't in the source text or
the supplied incident context. Keep technical terms (part numbers, serial
numbers, measurements, vendor names) exactly as written. Do not add a
preamble, sign-off, or markdown — return ONLY the rewritten field text.
`.trim();

function polishSystemPrompt(field: string): string {
  return [
    `You are a copy editor for incident reports. Fix spelling, grammar,`,
    `punctuation, capitalization, and obvious typos in the "${field}" field`,
    `WITHOUT changing meaning, ordering, or technical facts. Preserve part`,
    `numbers, serial numbers, measurements, and vendor names verbatim.`,
    `Examples of fixes you must make: "dissasembled" → "disassembled",`,
    `"mismaufactured" → "manufactured", "recieved" → "received".`,
    ``,
    STYLE_GUIDE,
  ].join('\n');
}

function expandSystemPrompt(field: string): string {
  return [
    `You are drafting the "${field}" field of an incident report from rough`,
    `notes or bullet points. Expand into a clear, professional paragraph (or`,
    `two short paragraphs if needed). Do NOT add facts that are not present`,
    `in the input. If the input is too sparse to expand responsibly, return`,
    `a single sentence that paraphrases what's there and nothing more.`,
    ``,
    STYLE_GUIDE,
  ].join('\n');
}

function customerRewriteSystemPrompt(field: string): string {
  return [
    `You are rewriting the "${field}" field of an incident report for the`,
    `customer-facing version. The customer is a wireline service company`,
    `reading XConnect's final report. Make the text accountable, clear, and`,
    `solution-oriented. Remove internal jargon, finger-pointing, casual`,
    `slang, and any blame language. Emphasize what XConnect did to resolve`,
    `or prevent recurrence. Keep all technical facts (parts, measurements,`,
    `dates, serials) exactly as in the source.`,
    ``,
    STYLE_GUIDE,
  ].join('\n');
}

const REVIEW_SYSTEM_PROMPT = `
You are a senior quality manager reviewing an incident report before it
goes to a wireline-service customer. Return a STRICT JSON object — no
prose, no markdown, no code fences — with the shape:

{ "findings": [ { "severity": "high"|"medium"|"low",
                  "field": "<one of: incident_description, investigation,
                            root_cause, corrective_action,
                            preventive_action, notes, incident_status,
                            action_status, report>",
                  "issue": "<concrete description of the problem>",
                  "suggestion": "<specific, actionable fix>" } ] }

Flag every instance of these recurring problem classes:

1. Status contradictions. Example: incident_status is "Final Review" or
   "Closed" but action_status is not "Complete"; closed_date set but
   action_status still "Open"; report says "resolved" but status fields
   disagree.
2. Vague preventive or corrective actions. Phrases like "QC process was
   revised", "training will be given", "process improved" with no specifics
   (what changed, who owns it, by when, what document) are HIGH severity.
3. Missing quantitative evidence. If the description or investigation
   references measurements, dimensions, torque, pressure, or specs but no
   numbers/units appear in the text, flag it.
4. Symptom → cause gaps. The description states a symptom (e.g. "tool
   failed to fire", "part broke", "leak observed") but the root_cause does
   not mechanically connect the chain from symptom to underlying cause.
5. Spelling and grammar errors. Flag obvious typos individually
   (low severity unless the typo changes meaning).
6. Placeholder or unfilled values. "TBD", "TODO", "xxx", "N/A" in fields
   that need a real answer (root_cause, corrective_action,
   preventive_action) are HIGH severity. Empty critical fields too.

Severity guidance:
- high: blocks the report from being sent (contradictions, vague
  preventive action, missing root cause, placeholder in critical field).
- medium: should be fixed before sending (missing measurements, weak
  symptom-cause chain, ambiguous ownership).
- low: copy edit only (typos, minor grammar).

If the report is clean, return { "findings": [] }. Output JSON only.
`.trim();

function buildReviewUserMessage(incident: Record<string, unknown>): string {
  const lines: string[] = ['Review the following incident report.'];
  const push = (label: string, key: string) => {
    const v = incident[key];
    if (v === undefined || v === null || v === '') return;
    lines.push('', `--- ${label} (${key}) ---`, String(v));
  };
  push('Incident Status', 'incident_status');
  push('Action Status', 'action_status');
  push('XC Caused', 'xc_caused');
  push('Vendor Caused', 'vendor_caused');
  push('Event Category', 'event_category');
  push('Severity', 'incident_severity');
  push('Failed Component', 'failed_component_label');
  push('Failure Type', 'failure_type_label');
  push('Customer', 'customer_label');
  push('Closed Date', 'closed_date');
  push('Report Sent', 'report_sent');
  for (const f of ASSISTANT_FIELDS) push(FIELD_LABELS[f], f);
  return lines.join('\n');
}

// ── Findings parser (mirror aiAssistantCore.ts) ─────────────────────────────

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const fence = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/;
  const m = trimmed.match(fence);
  return m ? m[1].trim() : trimmed;
}

function normalizeSeverity(v: unknown): 'high' | 'medium' | 'low' | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'high' || s === 'critical' || s === 'blocker') return 'high';
  if (s === 'medium' || s === 'med' || s === 'moderate') return 'medium';
  if (s === 'low' || s === 'minor' || s === 'info') return 'low';
  return null;
}

function parseFindings(raw: unknown): ReviewFinding[] {
  let value: unknown = raw;
  if (typeof value === 'string') {
    value = stripCodeFences(value);
    try { value = JSON.parse(value as string); } catch { return []; }
  }
  let arr: unknown[];
  if (Array.isArray(value)) arr = value;
  else if (value && typeof value === 'object' && Array.isArray((value as any).findings)) {
    arr = (value as any).findings;
  } else return [];

  const out: ReviewFinding[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const severity = normalizeSeverity(it.severity);
    const field = typeof it.field === 'string' ? it.field.trim() : '';
    const issue = typeof it.issue === 'string' ? it.issue.trim() : '';
    const suggestion = typeof it.suggestion === 'string' ? it.suggestion.trim() : '';
    if (!severity || !field || !issue) continue;
    out.push({ severity, field, issue, suggestion });
  }
  return out;
}

// ── Provider abstraction ────────────────────────────────────────────────────

interface ProviderChatArgs {
  systemPrompt: string;
  userPrompt: string;
  /** When true the provider is asked for JSON output and low temperature. */
  jsonMode?: boolean;
}

interface Provider {
  name: string;
  model: string;
  chat(args: ProviderChatArgs): Promise<string>;
}

function getProvider(): Provider {
  const name = (Deno.env.get('AI_PROVIDER') || 'anthropic').toLowerCase();
  if (name === 'anthropic') return anthropicProvider();
  if (name === 'openai') return openaiProvider();
  throw new Error(`Unknown AI_PROVIDER "${name}". Use "anthropic" or "openai".`);
}

function anthropicProvider(): Provider {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const model = Deno.env.get('AI_MODEL') || DEFAULT_ANTHROPIC_MODEL;
  return {
    name: 'anthropic',
    model,
    async chat({ systemPrompt, userPrompt, jsonMode }) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: jsonMode ? 2000 : 1500,
          temperature: jsonMode ? 0 : 0.2,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
      }
      const data = await res.json();
      // Anthropic content is an array of blocks; we only ask for text.
      const block = Array.isArray(data.content) ? data.content.find((b: any) => b.type === 'text') : null;
      const text = block?.text ?? '';
      if (!text) throw new Error('Anthropic returned empty content');
      return String(text);
    },
  };
}

function openaiProvider(): Provider {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const model = Deno.env.get('AI_MODEL') || DEFAULT_OPENAI_MODEL;
  return {
    name: 'openai',
    model,
    async chat({ systemPrompt, userPrompt, jsonMode }) {
      const body: Record<string, unknown> = {
        model,
        temperature: jsonMode ? 0 : 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      };
      if (jsonMode) body.response_format = { type: 'json_object' };
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`OpenAI ${res.status}: ${t.slice(0, 500)}`);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error('OpenAI returned empty content');
      return String(text);
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncate(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.length <= max ? s : s.slice(0, max);
}

function isAssistantField(s: unknown): s is string {
  return typeof s === 'string' && (ASSISTANT_FIELDS as readonly string[]).includes(s);
}

// ── Router ──────────────────────────────────────────────────────────────────

export const aiAssistRoutes = new Hono();

// Require a signed-in user: this route calls paid AI provider APIs, so it must
// not be reachable with just the public anon key. Guarded per-route (not via
// use('*')) because this router is mounted at the same base path as the public
// auth routes, and a wildcard middleware would leak onto them.
aiAssistRoutes.post('/ai-assist', requireUser, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const action = body?.action as AIAction | undefined;
  if (action !== 'polish' && action !== 'expand' && action !== 'customer_rewrite' && action !== 'review') {
    return c.json({ error: `Unknown action "${String(action)}"` }, 400);
  }

  let provider: Provider;
  try {
    provider = getProvider();
  } catch (err: any) {
    console.error('ai-assist provider config error:', err?.message || err);
    return c.json({ error: err?.message || 'AI provider misconfigured' }, 500);
  }

  try {
    if (action === 'review') {
      const incident = body?.incident;
      if (!incident || typeof incident !== 'object') {
        return c.json({ error: 'review requires an "incident" object' }, 400);
      }
      const userPrompt = truncate(buildReviewUserMessage(incident), MAX_INCIDENT_CHARS);
      const raw = await provider.chat({
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        userPrompt,
        jsonMode: true,
      });
      const findings = parseFindings(raw);
      return c.json({ findings, provider: provider.name, model: provider.model });
    }

    const field = body?.field;
    const text = truncate(body?.text, MAX_FIELD_CHARS);
    if (!isAssistantField(field)) {
      return c.json({ error: `Unsupported field "${String(field)}"` }, 400);
    }
    if (!text || !text.trim()) {
      return c.json({ error: 'text is required for this action' }, 400);
    }

    const systemPrompt =
      action === 'polish' ? polishSystemPrompt(field)
      : action === 'expand' ? expandSystemPrompt(field)
      : customerRewriteSystemPrompt(field);

    const result = await provider.chat({ systemPrompt, userPrompt: text, jsonMode: false });
    return c.json({ result: result.trim(), provider: provider.name, model: provider.model });
  } catch (err: any) {
    console.error('ai-assist provider error:', err?.message || err);
    return c.json({ error: err?.message || 'AI provider error' }, 502);
  }
});

export default aiAssistRoutes;
