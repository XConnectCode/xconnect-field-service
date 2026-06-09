import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, CheckCircle2, Save, ExternalLink, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth-context';
import { supabase } from '../lib/supabase';
import {
  getSession, updateSession,
  listCustomers, listDistrictsForCustomer,
  type ChecklistSession, type ChecklistStepResult,
  type CustomerOption, type DistrictOption,
} from '../lib/trainingChecklists';
import { generateTrainingVisitReportPDF } from '../lib/generateTrainingVisitReportPDF';
import SignaturePad from '../components/SignaturePad';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';

const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

export default function TrainingChecklistSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, accessToken } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'sqm';

  const [session, setSession] = useState<ChecklistSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // editable fields
  const [steps, setSteps] = useState<ChecklistStepResult[]>([]);
  const [customer, setCustomer] = useState('');           // customers.row_id (or legacy free-text)
  const [customerDistrict, setCustomerDistrict] = useState(''); // districts.row_id
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [signoff, setSignoff] = useState('');
  const [signoffSigUrl, setSignoffSigUrl] = useState<string | null>(null);

  // reference data for the customer / district dropdowns
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [districts, setDistricts] = useState<DistrictOption[]>([]);

  useEffect(() => { if (id) load(id); }, [id]);

  // Load the customer list once for the dropdown.
  useEffect(() => { listCustomers().then(setCustomers).catch(() => {}); }, []);

  // Cascade districts off the selected customer.
  useEffect(() => {
    if (!customer) { setDistricts([]); return; }
    listDistrictsForCustomer(customer).then(setDistricts).catch(() => setDistricts([]));
  }, [customer]);

  const load = async (sid: string) => {
    setLoading(true);
    try {
      const s = await getSession(sid);
      if (s) {
        setSession(s);
        setSteps(s.step_results || []);
        setCustomer(s.customer || '');
        setCustomerDistrict(s.customer_district || '');
        setLocation(s.location || '');
        setNotes(s.notes || '');
        setSignoff(s.signoff_name || '');
        // Prefer the persisted column; otherwise rehydrate the latest uploaded
        // signoff signature from the images table so a reload before an explicit
        // Save still shows the drawn signature.
        if (s.signoff_sig_url) {
          setSignoffSigUrl(s.signoff_sig_url);
        } else {
          try {
            const resp = await fetch(`${baseUrl}/images/training_checklist_sessions/${encodeURIComponent(sid)}`, {
              headers: { Authorization: `Bearer ${accessToken ?? publicAnonKey}` },
            });
            if (resp.ok) {
              const imgData = await resp.json();
              const files = Array.isArray(imgData.files) ? imgData.files : [];
              const sig = files
                .filter((f: any) => f.fieldName === 'signoff_signature' && f.url)
                .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
              setSignoffSigUrl(sig?.url || null);
            } else {
              setSignoffSigUrl(null);
            }
          } catch {
            setSignoffSigUrl(null);
          }
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load session');
    }
    setLoading(false);
  };

  // Resolve the stored customer value (row_id or legacy free-text) to a display
  // name. Falls back to the raw value so legacy sessions never render blank.
  const customerDisplay = (() => {
    if (!customer) return '';
    const match = customers.find((c) => c.row_id === customer);
    return match ? match.customer : customer;
  })();

  const toggleStep = (stepId: string) => {
    setSteps((prev) => prev.map((r) => (r.id === stepId ? { ...r, done: !r.done } : r)));
  };

  const handleGenerateReport = async () => {
    if (!session) return;
    setGenerating(true);
    try {
      // Persist the latest in-memory edits into a session snapshot so the PDF
      // reflects what the SQM currently sees (without forcing a DB save).
      const snapshot: ChecklistSession = {
        ...session,
        step_results: steps,
        customer: customer || session.customer,
        customer_district: customerDistrict || session.customer_district,
        location: location.trim() || session.location,
        notes: notes.trim() || null,
        signoff_name: signoff.trim() || null,
        signoff_sig_url: signoffSigUrl || null,
      };
      // Pull the full linked field visit (if any) for the visit-details section.
      let visit: Record<string, any> | null = null;
      if (session.field_visit_id) {
        const { data } = await supabase
          .from('fieldvisits')
          .select('*')
          .eq('field_visit_id', session.field_visit_id)
          .maybeSingle();
        visit = data || null;
      }
      await generateTrainingVisitReportPDF({ visit, session: snapshot });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate report');
    }
    setGenerating(false);
  };

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = total > 0 && doneCount === total;

  const persist = async (markComplete: boolean) => {
    if (!session) return;
    setSaving(true);
    try {
      const updated = await updateSession(session.id, {
        step_results: steps,
        customer: customer || null,
        customer_district: customerDistrict || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
        signoff_name: signoff.trim() || null,
        signoff_sig_url: signoffSigUrl || null,
        ...(markComplete ? { status: 'completed' } : {}),
      });
      setSession(updated);
      toast.success(markComplete ? 'Training marked complete' : 'Saved');
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="p-8"><div className="max-w-3xl mx-auto text-center py-12">Loading...</div></div>;
  }
  if (!session) {
    return (
      <div className="p-8">
        <div className="max-w-3xl mx-auto text-center py-12">
          <p className="text-gray-500 mb-4">Training session not found</p>
          <Button onClick={() => navigate('/training-checklists')}>Back to Training Checklists</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/training-checklists')} className="-ml-1 text-gray-600 dark:text-gray-300">
          <ArrowLeft className="w-4 h-4 mr-1" />Back to Training Checklists
        </Button>

        {/* Header card */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{session.template_name}</h1>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {session.product_line && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">{session.product_line}</Badge>}
                  {session.kind === 'xfire' && <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200">XFire</Badge>}
                  {session.status === 'completed' ? (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />Completed
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200">In progress</Badge>
                  )}
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="text-right">
                  <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">{doneCount}/{total}</div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide">steps complete</div>
                </div>
                <Button variant="outline" size="sm" onClick={handleGenerateReport} disabled={generating}>
                  <FileDown className="w-4 h-4 mr-2" />{generating ? 'Generating...' : 'Download Report'}
                </Button>
              </div>
            </div>
            {session.field_visit_id && (
              <button
                onClick={() => navigate(`/field-visits`)}
                className="mt-3 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />Linked field visit: {session.field_visit_id}
              </button>
            )}
          </CardContent>
        </Card>

        {/* Session details */}
        <Card>
          <CardHeader><CardTitle className="text-base">Session Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer</label>
                {canEdit ? (
                  <select
                    value={customer}
                    onChange={(e) => { setCustomer(e.target.value); setCustomerDistrict(''); }}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-md p-2 text-sm"
                  >
                    <option value="">Select customer…</option>
                    {/* Preserve a legacy free-text customer that isn't in the table. */}
                    {customer && !customers.some((c) => c.row_id === customer) && (
                      <option value={customer}>{customer}</option>
                    )}
                    {customers.map((c) => (
                      <option key={c.row_id} value={c.row_id}>{c.customer}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-gray-800 dark:text-gray-200 py-2">{customerDisplay || '—'}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer District</label>
                {canEdit ? (
                  <select
                    value={customerDistrict}
                    onChange={(e) => setCustomerDistrict(e.target.value)}
                    disabled={!customer}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-md p-2 text-sm disabled:opacity-60"
                  >
                    <option value="">{customer ? 'Select district…' : '— Pick a customer first —'}</option>
                    {customerDistrict && !districts.some((d) => d.row_id === customerDistrict) && (
                      <option value={customerDistrict}>{customerDistrict}</option>
                    )}
                    {districts.map((d) => (
                      <option key={d.row_id} value={d.row_id}>{d.customer_district}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-gray-800 dark:text-gray-200 py-2">
                    {districts.find((d) => d.row_id === customerDistrict)?.customer_district || customerDistrict || '—'}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location (optional)</label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} disabled={!canEdit} placeholder="Site / location" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-gray-500">
              <div>SQM: <span className="text-gray-800 dark:text-gray-200">{session.trainer_name || '—'}</span></div>
              <div>Date: <span className="text-gray-800 dark:text-gray-200">{new Date(session.training_date).toLocaleDateString()}</span></div>
            </div>
          </CardContent>
        </Card>

        {/* Steps */}
        <Card>
          <CardHeader><CardTitle className="text-base">Checklist Steps</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {steps.length === 0 ? (
              <p className="text-gray-500 text-sm">This template has no steps.</p>
            ) : steps.map((s) => (
              <label
                key={s.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  s.done ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20' : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700 hover:bg-gray-50'
                } ${!canEdit ? 'cursor-default' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={s.done}
                  disabled={!canEdit}
                  onChange={() => toggleStep(s.id)}
                  className="mt-0.5 w-5 h-5 rounded accent-emerald-600"
                />
                <span className={`text-sm ${s.done ? 'text-emerald-900 dark:text-emerald-200 line-through' : 'text-gray-800 dark:text-gray-200'}`}>
                  {s.text}
                </span>
              </label>
            ))}
          </CardContent>
        </Card>

        {/* Notes & signoff */}
        <Card>
          <CardHeader><CardTitle className="text-base">Notes & Signoff</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={!canEdit}
                rows={4}
                className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                placeholder="Training notes, follow-ups, customer questions..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Signoff (customer / trainee name)</label>
              <Input value={signoff} onChange={(e) => setSignoff(e.target.value)} disabled={!canEdit} placeholder="Name of person signing off" />
            </div>
            <div>
              <SignaturePad
                parentTable="training_checklist_sessions"
                parentRowId={id!}
                fieldName="signoff_signature"
                label="Signature"
                baseUrl={baseUrl}
                publicAnonKey={publicAnonKey}
                existingUrl={signoffSigUrl}
                disabled={!canEdit}
                onSaved={(url) => setSignoffSigUrl(url)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        {canEdit && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => persist(false)} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />{saving ? 'Saving...' : 'Save'}
            </Button>
            {session.status !== 'completed' && (
              <Button onClick={() => persist(true)} disabled={saving || !allDone || !signoffSigUrl} title={!allDone ? 'Complete all steps first' : !signoffSigUrl ? 'Save a signature before completing' : 'Mark training complete'}>
                <CheckCircle2 className="w-4 h-4 mr-2" />Mark Complete
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
