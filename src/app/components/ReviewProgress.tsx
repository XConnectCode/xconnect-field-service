/**
 * ReviewProgress — the ordered incident review checklist.
 *
 * Renders the steps from `getReviewSteps()` (fields → director review →
 * generate report → send to customer → close) with a contextual action button
 * on whichever step is currently actionable. The generate/send steps only
 * appear for XC-caused / Inconclusive incidents.
 *
 * Extracted from Dashboard.tsx so the Incident Detail page can render the exact
 * same checklist and stay in lockstep with the Dashboard review queue. The
 * markup/styles are intentionally identical to the original inline version.
 */
import type { ReviewStep } from '../lib/incidentWorkflow';

export interface ReviewProgressProps {
  steps: ReviewStep[];
  isDark: boolean;
  onMarkReviewed: () => void;
  onGenerateReport: () => void;
  onSendToCustomer: () => void;
  onCloseIncident: () => void;
  busy: boolean;
  /**
   * Optional: when provided, each "Missing" field label becomes a clickable
   * chip that asks the host (the incident modal) to scroll to + focus that
   * field's editor. The label string matches REQUIRED_FOR_FINAL_REVIEW labels.
   */
  onFocusField?: (label: string) => void;
  /**
   * Optional per-step helper notes keyed by step id (e.g. 'generate', 'sent').
   * The Dashboard modal uses these to warn that a step opens the full incident
   * page; the Incident Detail page (already on that page) omits them.
   */
  actionNotes?: Partial<Record<string, string>>;
}

export default function ReviewProgress({
  steps,
  isDark,
  onMarkReviewed,
  onGenerateReport,
  onSendToCustomer,
  onCloseIncident,
  busy,
  onFocusField,
  actionNotes,
}: ReviewProgressProps) {
  const txtPrimary = isDark ? '#f1f5f9' : '#0f172a';
  const txtSubtle = isDark ? '#94a3b8' : '#64748b';
  const cardBg = isDark ? '#0f172a' : '#f8fafc';
  const border = isDark ? '#334155' : '#e2e8f0';

  const actionFor = (id: string) => {
    if (id === 'review')   return { label: '✓ Mark Reviewed', fn: onMarkReviewed, bg: '#16a34a' };
    if (id === 'generate') return { label: 'Generate Report ↗', fn: onGenerateReport, bg: '#2563eb' };
    if (id === 'sent')     return { label: 'Send to Customer ↗', fn: onSendToCustomer, bg: '#4A154B' };
    if (id === 'closed')   return { label: 'Close Incident', fn: onCloseIncident, bg: '#475569' };
    return null;
  };

  return (
    <div style={{ margin: '0 0 18px', border: `1px solid ${border}`, borderRadius: 10, background: cardBg, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${border}`, fontSize: 12, fontWeight: 700, color: txtPrimary, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Review Progress
      </div>
      <div>
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          const action = actionFor(s.id);
          const showAction = !!action && s.actionable && s.allowedForRole;
          // Circle: done = green check, actionable = blue numbered, blocked = grey.
          const circleBg = s.done ? '#16a34a' : (s.actionable ? '#3b82f6' : (isDark ? '#334155' : '#e2e8f0'));
          const circleColor = s.done || s.actionable ? '#fff' : (isDark ? '#64748b' : '#94a3b8');
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderBottom: isLast ? 'none' : `1px solid ${border}` }}>
              <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: circleBg, color: circleColor, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                {s.done ? '✓' : i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: s.done ? txtSubtle : txtPrimary }}>
                  {s.label}
                  {s.actionable && !s.done && (
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20, background: '#3b82f6', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Next</span>
                  )}
                </div>
                {/* Missing-field detail for the fields step. When onFocusField
                    is provided, each missing field is a clickable chip that
                    jumps to + focuses its editor in the modal. */}
                {s.id === 'fields' && !s.done && s.missing.length > 0 && (
                  onFocusField ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5, alignItems: 'center' }}>
                      <span style={{ fontSize: 11.5, color: isDark ? '#fca5a5' : '#b91c1c', fontWeight: 600 }}>Missing:</span>
                      {s.missing.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => onFocusField(m)}
                          title={`Fill in ${m}`}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, cursor: 'pointer',
                            border: `1px solid ${isDark ? '#7f1d1d' : '#fecaca'}`,
                            background: isDark ? '#450a0a' : '#fef2f2',
                            color: isDark ? '#fca5a5' : '#b91c1c',
                          }}
                        >
                          {m} →
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: isDark ? '#fca5a5' : '#b91c1c', marginTop: 3, lineHeight: 1.5 }}>
                      Missing: {s.missing.join(', ')}
                    </div>
                  )
                )}
                {/* Host-provided helper note for an actionable step (e.g. that
                    Send to Customer opens the full incident page). */}
                {!s.done && s.actionable && s.allowedForRole && actionNotes?.[s.id] && (
                  <div style={{ fontSize: 11.5, color: txtSubtle, marginTop: 3, lineHeight: 1.5, fontStyle: 'italic' }}>
                    {actionNotes[s.id]}
                  </div>
                )}
                {/* Why this step is blocked. */}
                {!s.done && !s.actionable && s.blockedReason && (
                  <div style={{ fontSize: 11.5, color: txtSubtle, marginTop: 3 }}>{s.blockedReason}</div>
                )}
                {/* Role-not-allowed note when actionable but wrong role. */}
                {!s.done && s.actionable && !s.allowedForRole && s.blockedReason && (
                  <div style={{ fontSize: 11.5, color: txtSubtle, marginTop: 3 }}>{s.blockedReason}</div>
                )}
              </div>
              {showAction && (
                <button onClick={action!.fn} disabled={busy} style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 6, border: 'none', background: action!.bg, color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                  {action!.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
