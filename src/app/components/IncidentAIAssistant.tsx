/**
 * IncidentAIAssistant.tsx
 *
 * Side-panel assistant for the incident form. Renders as a fixed slide-over
 * on the right edge of the viewport (portal'd to <body>) so it can coexist
 * with the IncidentForm Radix Dialog without fighting its overlay or focus
 * trap. It is intentionally NOT a Radix Sheet — stacking a Sheet on top of
 * the form Dialog creates double-overlays and focus-trap conflicts.
 *
 * The panel never writes to Supabase. `onAccept(field, text)` hands the
 * suggested text back to the parent so it can splice the value into form
 * state (in our case, set it on a textarea ref so the uncontrolled
 * <form>'s FormData picks it up at submit time).
 *
 * Network calls go to the Supabase Edge Function at
 *   POST /make-server-64775d98/ai-assist
 * which holds the provider API key. See supabase/functions/server/ai-assist.tsx.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import {
  Sparkles, Pencil, MessageSquare, ClipboardCheck, Loader2, X,
  Check, Copy, AlertTriangle, AlertCircle, Info,
} from 'lucide-react';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { supabase } from '../lib/supabase';
import {
  ASSISTANT_FIELDS,
  FIELD_LABELS,
  severityRank,
  type AIAction,
  type AssistantField,
  type ReviewFinding,
  type Severity,
} from '../lib/aiAssistantCore';

const EDGE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98/ai-assist`;

export interface IncidentSnapshot {
  incident_description?: string;
  investigation?: string;
  root_cause?: string;
  corrective_action?: string;
  preventive_action?: string;
  notes?: string;
  incident_status?: string;
  action_status?: string;
  xc_caused?: string;
  vendor_caused?: string;
  event_category?: string;
  incident_severity?: string;
  closed_date?: string;
  report_sent?: any;
  failed_component_label?: string;
  failure_type_label?: string;
  customer_label?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Currently selected field — the panel preselects it. */
  field: AssistantField;
  onFieldChange: (f: AssistantField) => void;
  /** Reads current field text from the parent (refs to the form's textareas). */
  getFieldText: (f: AssistantField) => string;
  /** Builds the read-only context payload for the review action. */
  getIncidentSnapshot: () => IncidentSnapshot;
  /** Apply accepted suggestion to the parent form. */
  onAccept: (field: AssistantField, text: string) => void;
  /** Scroll a field into view + focus it when a review finding is clicked. */
  onFocusField?: (field: AssistantField) => void;
}

type Mode = 'rewrite' | 'review';

type RewriteAction = Exclude<AIAction, 'review'>;

const REWRITE_ACTIONS: { key: RewriteAction; label: string; icon: any; tip: string }[] = [
  { key: 'polish', label: 'Polish', icon: Pencil, tip: 'Fix spelling and grammar' },
  { key: 'expand', label: 'Expand', icon: Sparkles, tip: 'Draft from rough notes' },
  { key: 'customer_rewrite', label: 'Customer tone', icon: MessageSquare, tip: 'Rewrite for the customer-facing report' },
];

async function callAiAssist(body: Record<string, unknown>): Promise<any> {
  // The /ai-assist edge route now requires a signed-in user (it calls paid AI
  // APIs), so forward the live session token and fall back to anon if absent.
  let token = publicAnonKey;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    // ignore - fall back to anon
  }
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

function SeverityChip({ severity }: { severity: Severity }) {
  if (severity === 'high') {
    return (
      <Badge className="bg-red-600 text-white hover:bg-red-600 gap-1">
        <AlertCircle className="w-3 h-3" /> High
      </Badge>
    );
  }
  if (severity === 'medium') {
    return (
      <Badge className="bg-amber-500 text-white hover:bg-amber-500 gap-1">
        <AlertTriangle className="w-3 h-3" /> Medium
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Info className="w-3 h-3" /> Low
    </Badge>
  );
}

export default function IncidentAIAssistant({
  open, onClose, field, onFieldChange, getFieldText, getIncidentSnapshot,
  onAccept, onFocusField,
}: Props) {
  const [mode, setMode] = useState<Mode>('rewrite');
  const [loading, setLoading] = useState<AIAction | null>(null);
  const [suggestion, setSuggestion] = useState<string>('');
  const [suggestionFor, setSuggestionFor] = useState<AssistantField | null>(null);
  const [suggestionAction, setSuggestionAction] = useState<RewriteAction | null>(null);
  const [error, setError] = useState<string>('');
  const [findings, setFindings] = useState<ReviewFinding[] | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Radix Dialog (the parent IncidentForm) attaches NATIVE document-level
  // listeners (DismissableLayer + FocusScope) to detect "outside" pointer/
  // focus events. React's synthetic capture handlers do NOT stop those native
  // listeners. Since this panel is portal'd to <body> (outside the Dialog),
  // we must stop the native events at the capture phase on the panel node
  // itself so they never bubble to document — otherwise any click here closes
  // the Dialog (and unmounts the panel).
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const stop = (e: Event) => e.stopPropagation();
    const events = ['pointerdown', 'mousedown', 'touchstart', 'focusin'] as const;
    events.forEach((evt) => node.addEventListener(evt, stop, true));
    return () => events.forEach((evt) => node.removeEventListener(evt, stop, true));
  }, [open]);

  // Reset suggestion when the user switches fields so we never accept a
  // stale rewrite into the wrong field.
  useEffect(() => {
    setSuggestion('');
    setSuggestionFor(null);
    setSuggestionAction(null);
    setError('');
  }, [field]);

  const sortedFindings = useMemo(() => {
    if (!findings) return null;
    return [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  }, [findings]);

  if (!open) return null;

  const runRewrite = async (action: RewriteAction) => {
    const text = getFieldText(field).trim();
    if (!text) {
      toast.error(`${FIELD_LABELS[field]} is empty — type some notes first.`);
      return;
    }
    setLoading(action);
    setError('');
    setSuggestion('');
    try {
      const data = await callAiAssist({ action, field, text });
      const result = String(data?.result ?? '').trim();
      if (!result) throw new Error('AI returned empty text');
      setSuggestion(result);
      setSuggestionFor(field);
      setSuggestionAction(action);
    } catch (err: any) {
      setError(err?.message || 'AI request failed');
    } finally {
      setLoading(null);
    }
  };

  const runReview = async () => {
    setLoading('review');
    setError('');
    setFindings(null);
    try {
      const incident = getIncidentSnapshot();
      const data = await callAiAssist({ action: 'review', incident });
      const list: ReviewFinding[] = Array.isArray(data?.findings) ? data.findings : [];
      setFindings(list);
    } catch (err: any) {
      setError(err?.message || 'Review request failed');
    } finally {
      setLoading(null);
    }
  };

  const accept = () => {
    if (!suggestion || !suggestionFor) return;
    onAccept(suggestionFor, suggestion);
    toast.success(`${FIELD_LABELS[suggestionFor]} updated. Save the incident to persist.`);
    setSuggestion('');
    setSuggestionFor(null);
    setSuggestionAction(null);
  };

  const reject = () => {
    setSuggestion('');
    setSuggestionFor(null);
    setSuggestionAction(null);
  };

  const copy = async () => {
    if (!suggestion) return;
    try {
      await navigator.clipboard.writeText(suggestion);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleFindingClick = (f: ReviewFinding) => {
    if (!onFocusField) return;
    if ((ASSISTANT_FIELDS as readonly string[]).includes(f.field)) {
      onFocusField(f.field as AssistantField);
    }
  };

  const isAssistantFieldName = (s: string): s is AssistantField =>
    (ASSISTANT_FIELDS as readonly string[]).includes(s);

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="AI Incident Assistant"
      data-ai-assistant-panel=""
      // The parent IncidentForm is a Radix Dialog whose DismissableLayer +
      // FocusScope listen on `document`. Because this panel is portal'd to
      // <body> (outside the Dialog), any pointer/focus event here is seen by
      // Radix as an "outside" interaction and closes the Dialog. Stopping
      // these events at the capture phase prevents them from ever reaching
      // Radix's document-level listeners, so the Dialog stays open and the
      // panel is fully interactive.
      onPointerDownCapture={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => e.stopPropagation()}
      onFocusCapture={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // CRITICAL: Radix's modal Dialog sets `pointer-events: none` on <body>
      // while open. This panel is portal'd as a direct child of <body>, so it
      // INHERITS pointer-events:none and becomes completely unclickable — every
      // click falls through to the Dialog overlay and dismisses the modal.
      // Forcing pointer-events:auto here re-enables interaction with the panel.
      style={{ pointerEvents: 'auto' }}
      className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-gray-900">AI Assistant</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
          aria-label="Close AI assistant"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex border-b border-gray-200 shrink-0">
        <button
          type="button"
          onClick={() => setMode('rewrite')}
          className={`flex-1 px-4 py-2 text-xs font-medium ${
            mode === 'rewrite'
              ? 'border-b-2 border-indigo-600 text-indigo-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Polish / Expand / Tone
        </button>
        <button
          type="button"
          onClick={() => setMode('review')}
          className={`flex-1 px-4 py-2 text-xs font-medium ${
            mode === 'review'
              ? 'border-b-2 border-indigo-600 text-indigo-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Review Report
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {mode === 'rewrite' && (
          <>
            <div>
              <Label className="text-xs font-semibold text-gray-600 mb-1 block">Field</Label>
              <select
                value={field}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isAssistantFieldName(v)) onFieldChange(v);
                }}
                className="w-full border border-gray-300 rounded-md p-2 text-sm"
              >
                {ASSISTANT_FIELDS.map((f) => (
                  <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-xs font-semibold text-gray-600 mb-1 block">Current text</Label>
              <div className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {getFieldText(field).trim() || (
                  <span className="text-gray-400">(empty — type notes in the form first)</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {REWRITE_ACTIONS.map(({ key, label, icon: Icon, tip }) => (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading !== null}
                  onClick={() => runRewrite(key)}
                  title={tip}
                  className="flex flex-col items-center gap-1 h-auto py-2"
                >
                  {loading === key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                  <span className="text-[11px]">{label}</span>
                </Button>
              ))}
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {error}
              </div>
            )}

            {suggestion && suggestionFor && (
              <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-900">
                    Suggested ({suggestionAction === 'polish'
                      ? 'Polish'
                      : suggestionAction === 'expand'
                      ? 'Expanded draft'
                      : 'Customer tone'})
                    {' · '}
                    {FIELD_LABELS[suggestionFor]}
                  </span>
                </div>
                <Textarea
                  value={suggestion}
                  onChange={(e) => setSuggestion(e.target.value)}
                  rows={8}
                  className="bg-white text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={accept} className="gap-1">
                    <Check className="h-3 w-3" /> Accept
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={reject}>
                    Reject
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={copy} className="gap-1">
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
                <p className="text-[11px] text-indigo-800/80">
                  Accepting only updates the form. Save the incident to persist.
                </p>
              </div>
            )}
          </>
        )}

        {mode === 'review' && (
          <>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
              <p className="font-semibold text-gray-800">Full-report review</p>
              <p>
                Checks for status contradictions, vague preventive actions, missing
                measurements, symptom→cause gaps, typos, and placeholders.
              </p>
            </div>

            <Button
              type="button"
              onClick={runReview}
              disabled={loading !== null}
              className="w-full gap-2"
            >
              {loading === 'review' ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Reviewing…</>
              ) : (
                <><ClipboardCheck className="h-4 w-4" /> Review report</>
              )}
            </Button>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {error}
              </div>
            )}

            {sortedFindings && sortedFindings.length === 0 && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                No issues found. The report looks ready.
              </div>
            )}

            {sortedFindings && sortedFindings.length > 0 && (
              <ul className="space-y-2">
                {sortedFindings.map((f, i) => {
                  const isAssistantField = (ASSISTANT_FIELDS as readonly string[]).includes(f.field);
                  return (
                    <li
                      key={`${f.field}-${i}`}
                      className={`rounded-md border p-3 text-xs space-y-1 ${
                        f.severity === 'high'
                          ? 'border-red-200 bg-red-50'
                          : f.severity === 'medium'
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <SeverityChip severity={f.severity} />
                        {isAssistantField ? (
                          <button
                            type="button"
                            className="text-[11px] font-mono text-indigo-700 hover:underline"
                            onClick={() => handleFindingClick(f)}
                          >
                            {FIELD_LABELS[f.field as AssistantField] || f.field}
                          </button>
                        ) : (
                          <span className="text-[11px] font-mono text-gray-600">{f.field}</span>
                        )}
                      </div>
                      <p className="text-gray-900 font-medium">{f.issue}</p>
                      {f.suggestion && (
                        <p className="text-gray-700">
                          <span className="font-semibold">Suggestion: </span>
                          {f.suggestion}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <footer className="border-t border-gray-200 px-4 py-2 shrink-0 text-[11px] text-gray-500">
        AI suggestions are advisory. Always verify before sending to a customer.
      </footer>
    </div>
  );

  return createPortal(panel, document.body);
}
