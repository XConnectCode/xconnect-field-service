/**
 * aiAssistantCore.ts
 *
 * Pure, dependency-free helpers shared between the browser and the Supabase
 * Edge Function for the in-app AI incident assistant. Keeping the prompt
 * builders and the findings parser here lets us unit-test them from Node
 * without spinning up Deno.
 *
 * The Edge Function (supabase/functions/server/ai-assist.tsx) re-imports
 * these values. Anything that touches `fetch`, env vars, or providers lives
 * outside this file.
 */

export type AIAction = 'polish' | 'expand' | 'customer_rewrite' | 'review' | 'summarize';

export const ASSISTANT_FIELDS = [
  'incident_description',
  'investigation',
  'root_cause',
  'corrective_action',
  'preventive_action',
  'notes',
] as const;

export type AssistantField = (typeof ASSISTANT_FIELDS)[number];

export type Severity = 'high' | 'medium' | 'low';

export interface ReviewFinding {
  severity: Severity;
  field: string;
  issue: string;
  suggestion: string;
}

/** Hard caps to keep provider costs and latency predictable. */
export const MAX_FIELD_CHARS = 8000;
export const MAX_INCIDENT_CHARS = 32000;

/** Human-readable labels for the fields the assistant can touch. */
export const FIELD_LABELS: Record<AssistantField, string> = {
  incident_description: 'Incident Description',
  investigation: 'Investigation',
  root_cause: 'Root Cause',
  corrective_action: 'Corrective Action',
  preventive_action: 'Preventive Action',
  notes: 'Notes',
};

/** Shared voice/style instructions reused by every text-rewriting action. */
const STYLE_GUIDE = `
Voice: neutral, factual, technical incident-report English used by an oil &
gas field-service quality manager. Past tense for events that happened.
Avoid speculation, hedging ("perhaps", "maybe"), filler ("essentially"), or
marketing language. Never invent facts that aren't in the source text or
the supplied incident context. Keep technical terms (part numbers, serial
numbers, measurements, vendor names) exactly as written. Do not add a
preamble, sign-off, or markdown — return ONLY the rewritten field text.
`.trim();

export function polishSystemPrompt(field: string): string {
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

export function expandSystemPrompt(field: string): string {
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

export function customerRewriteSystemPrompt(field: string): string {
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

export function reviewSystemPrompt(): string {
  return REVIEW_SYSTEM_PROMPT;
}

// ── Summarize ───────────────────────────────────────────────────────────────
// Produces a short, neutral prose summary of an incident for the dashboard
// cards / Monday-meeting list. One LLM call, cached to incidents.ai_summary.

const SUMMARIZE_SYSTEM_PROMPT = [
  `You are a quality manager writing a one-glance summary of an oil & gas`,
  `field-service incident for a dashboard card. Write 1 to 2 short sentences`,
  `(max ~40 words total) capturing WHAT happened, the component/system`,
  `involved, and the current disposition (fault attribution + status) when`,
  `those are present. Lead with the failure/event itself, not the customer`,
  `name. Do NOT restate the incident ID, date, or customer name — those are`,
  `already shown on the card. Never invent facts not present in the input.`,
  `If the input is too sparse, summarize only what is given.`,
  ``,
  STYLE_GUIDE,
].join('\n');

export function summarizeSystemPrompt(): string {
  return SUMMARIZE_SYSTEM_PROMPT;
}

/** Fields used to build the summarization context, in priority order. */
export const SUMMARIZE_CONTEXT_FIELDS = [
  'incident_description',
  'investigation',
  'root_cause',
  'notes',
] as const;

/**
 * Build the user-side message for a summarize request. Serializes the free
 * text plus a compact line of structured context (category, component,
 * well/stage, fault, status) so the model can mention disposition.
 */
export function buildSummarizeUserMessage(incident: Record<string, unknown>): string {
  const lines: string[] = ['Summarize the following incident.'];

  const ctx: string[] = [];
  const pushCtx = (label: string, key: string) => {
    const v = incident[key];
    if (v === undefined || v === null || v === '') return;
    ctx.push(`${label}: ${String(v)}`);
  };
  pushCtx('Category', 'event_category');
  pushCtx('Severity', 'incident_severity');
  pushCtx('Failed Component', 'failed_component_label');
  pushCtx('Failure Type', 'failure_type_label');
  pushCtx('Well', 'well_name');
  pushCtx('Stage', 'stage#');
  pushCtx('XC Caused', 'xc_caused');
  pushCtx('Vendor Caused', 'vendor_caused');
  pushCtx('Status', 'incident_status');
  if (ctx.length) lines.push('', `Context: ${ctx.join(' · ')}`);

  const push = (label: string, key: string) => {
    const v = incident[key];
    if (v === undefined || v === null || v === '') return;
    lines.push('', `--- ${label} (${key}) ---`, String(v));
  };
  for (const f of SUMMARIZE_CONTEXT_FIELDS) {
    push(FIELD_LABELS[f as AssistantField] ?? f, f);
  }

  return lines.join('\n');
}

/**
 * Build the user-side message body for a review request. We serialize the
 * incident as labelled blocks rather than raw JSON so the model gets clear
 * field boundaries — this matters for the "field:" attribution in findings.
 */
export function buildReviewUserMessage(incident: Record<string, unknown>): string {
  const lines: string[] = ['Review the following incident report.'];

  const push = (label: string, key: string) => {
    const v = incident[key];
    if (v === undefined || v === null || v === '') return;
    lines.push('', `--- ${label} (${key}) ---`, String(v));
  };

  // Context fields (read-only — model should not flag these but use them).
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

  // Free-text fields the assistant operates on.
  for (const f of ASSISTANT_FIELDS) {
    push(FIELD_LABELS[f], f);
  }

  return lines.join('\n');
}

/**
 * Validate + normalize a model-returned findings payload. Defensive on
 * purpose: providers occasionally wrap JSON in code fences, return a bare
 * array, or omit fields. We accept any of those and reject items that
 * can't be coerced into the contract.
 */
export function parseFindings(raw: unknown): ReviewFinding[] {
  let value: unknown = raw;

  if (typeof value === 'string') {
    value = stripCodeFences(value);
    try {
      value = JSON.parse(value as string);
    } catch {
      return [];
    }
  }

  // Some providers return { findings: [...] }; some return the array directly.
  let arr: unknown[];
  if (Array.isArray(value)) {
    arr = value;
  } else if (value && typeof value === 'object' && Array.isArray((value as any).findings)) {
    arr = (value as any).findings;
  } else {
    return [];
  }

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

function normalizeSeverity(v: unknown): Severity | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'high' || s === 'critical' || s === 'blocker') return 'high';
  if (s === 'medium' || s === 'med' || s === 'moderate') return 'medium';
  if (s === 'low' || s === 'minor' || s === 'info') return 'low';
  return null;
}

/** Strip ```json … ``` and ``` … ``` fences a provider sometimes adds. */
export function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const fence = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/;
  const m = trimmed.match(fence);
  return m ? m[1].trim() : trimmed;
}

/** Defensive bounds check applied at the edge of the function. */
export function truncate(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/** Severity rank for sorting findings high → low. */
export function severityRank(s: Severity): number {
  return s === 'high' ? 0 : s === 'medium' ? 1 : 2;
}
