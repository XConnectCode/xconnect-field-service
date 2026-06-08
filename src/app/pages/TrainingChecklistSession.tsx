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
  type ChecklistSession, type ChecklistStepResult,
} from '../lib/trainingChecklists';
import { generateTrainingVisitReportPDF } from '../lib/generateTrainingVisitReportPDF';

export default function TrainingChecklistSession() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'sqm';

  const [session, setSession] = useState<ChecklistSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // editable fields
  const [steps, setSteps] = useState<ChecklistStepResult[]>([]);
  const [customer, setCustomer] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [signoff, setSignoff] = useState('');

  useEffect(() => { if (id) load(id); }, [id]);

  const load = async (sid: string) => {
    setLoading(true);
    try {
      const s = await getSession(sid);
      if (s) {
        setSession(s);
        setSteps(s.step_results || []);
        setCustomer(s.customer || '');
        setLocation(s.location || '');
        setNotes(s.notes || '');
        setSignoff(s.signoff_name || '');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load session');
    }
    setLoading(false);
  };

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
        customer: customer.trim() || session.customer,
        location: location.trim() || session.location,
        notes: notes.trim() || null,
        signoff_name: signoff.trim() || null,
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
        customer: customer.trim() || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
        signoff_name: signoff.trim() || null,
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
                <Input value={customer} onChange={(e) => setCustomer(e.target.value)} disabled={!canEdit} placeholder="Customer name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Signoff (customer / trainer name)</label>
              <Input value={signoff} onChange={(e) => setSignoff(e.target.value)} disabled={!canEdit} placeholder="Name of person signing off" />
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
              <Button onClick={() => persist(true)} disabled={saving || !allDone} title={!allDone ? 'Complete all steps first' : 'Mark training complete'}>
                <CheckCircle2 className="w-4 h-4 mr-2" />Mark Complete
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
