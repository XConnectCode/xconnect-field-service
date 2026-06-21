import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import {
  ListChecks, Plus, Settings, Eye, Trash2, CheckCircle2, Clock,
  AlertCircle, X, ClipboardList,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth-context';
import {
  listTemplates, listSessions, startSession, deleteSession, listTrainingVisits,
  listCustomers, listDistrictsForCustomer, getVisitAutofill,
  isMissingTableError,
  type ChecklistTemplate, type ChecklistSession,
  type CustomerOption, type DistrictOption, type TrainingVisitOption,
} from '../lib/trainingChecklists';

export default function TrainingChecklists() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const isAdmin = user?.role === 'admin';
  const canRun = isAdmin || user?.role === 'sqm';

  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [sessions, setSessions] = useState<ChecklistSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);

  // Start-session modal
  const [showStart, setShowStart] = useState(false);
  const [starting, setStarting] = useState(false);
  const [trainingVisits, setTrainingVisits] = useState<TrainingVisitOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [startForm, setStartForm] = useState({
    templateId: '', customer: '', customerDistrict: '', location: '', fieldVisitId: '',
  });

  useEffect(() => { fetchAll(); }, []);

  // Deep-link: /training-checklists?start=1&fieldVisitId=...
  // Customer/district/location are auto-filled by the visit effect below.
  useEffect(() => {
    if (searchParams.get('start') === '1') {
      setStartForm((s) => ({
        ...s,
        fieldVisitId: searchParams.get('fieldVisitId') || '',
      }));
      setShowStart(true);
    }
  }, [searchParams]);

  // Cascade districts off the selected customer (mirrors FieldVisitForm).
  useEffect(() => {
    if (!startForm.customer) { setDistricts([]); return; }
    listDistrictsForCustomer(startForm.customer).then(setDistricts);
  }, [startForm.customer]);

  // Auto-fill customer / district / location from the linked field visit.
  useEffect(() => {
    if (!startForm.fieldVisitId) return;
    getVisitAutofill(startForm.fieldVisitId).then((v) => {
      if (!v) return;
      setStartForm((s) => ({
        ...s,
        customer: v.customer || s.customer,
        customerDistrict: v.customer_district || s.customerDistrict,
        location: v.location || s.location,
      }));
    });
  }, [startForm.fieldVisitId]);

  // T1: once a customer (and optionally district) is selected, the field-visit
  // link dropdown must only show Training-purpose visits for that customer
  // (filtered further by district when one is chosen). The currently-selected
  // visit is always kept so an already-linked option never disappears.
  const visibleTrainingVisits = useMemo(() => {
    if (!startForm.customer) return trainingVisits;
    return trainingVisits.filter((v) => {
      if (v.field_visit_id === startForm.fieldVisitId) return true;
      if (v.customer_id !== startForm.customer) return false;
      if (startForm.customerDistrict && v.customer_district_id !== startForm.customerDistrict) return false;
      return true;
    });
  }, [trainingVisits, startForm.customer, startForm.customerDistrict, startForm.fieldVisitId]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [tpls, sess, visits, custs] = await Promise.all([
        listTemplates(false),
        listSessions(),
        listTrainingVisits(),
        listCustomers(),
      ]);
      setTemplates(tpls);
      setSessions(sess);
      setTrainingVisits(visits);
      setCustomers(custs);
      setTableMissing(false);
    } catch (err: any) {
      if (isMissingTableError(err)) setTableMissing(true);
      else toast.error('Failed to load training checklists');
    }
    setLoading(false);
  };

  const handleStart = async () => {
    const tpl = templates.find((t) => t.id === startForm.templateId);
    if (!tpl) { toast.error('Pick a checklist template'); return; }
    if (!startForm.customer) { toast.error('Select a customer'); return; }
    setStarting(true);
    try {
      const session = await startSession({
        template: tpl,
        fieldVisitId: startForm.fieldVisitId || null,
        customer: startForm.customer || null,
        customerDistrict: startForm.customerDistrict || null,
        location: startForm.location.trim() || null,
        trainerName: user?.name || null,
        trainerId: user?.id || null,
        createdBy: user?.id || null,
      });
      toast.success('Training session started');
      setShowStart(false);
      setStartForm({ templateId: '', customer: '', customerDistrict: '', location: '', fieldVisitId: '' });
      navigate(`/training-checklists/session/${session.id}`);
    } catch (err: any) {
      toast.error(err?.message || 'Could not start session');
    }
    setStarting(false);
  };

  const handleDeleteSession = async (s: ChecklistSession) => {
    if (!confirm(`Delete training session for "${s.customer || 'Unknown'}"?`)) return;
    try {
      await deleteSession(s.id);
      toast.success('Session deleted');
      fetchAll();
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    }
  };

  // Sessions store the customer as a customers.row_id (or a legacy free-text
  // name). Resolve to a readable name using the already-loaded customers list;
  // fall back to the raw value so nothing renders blank.
  const customerLabel = (val: string | null) => {
    if (!val) return null;
    return customers.find((c) => c.row_id === val)?.customer || val;
  };

  const progress = (s: ChecklistSession) => {
    const total = s.step_results?.length || 0;
    const done = s.step_results?.filter((r) => r.done).length || 0;
    return { done, total };
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-800/50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Training Checklists</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-1">
              Customer-training checklists for XFire Panel software & gun system product lines
            </p>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <Button variant="outline" size="lg" onClick={() => navigate('/training-checklist-setup')}>
                <Settings className="w-5 h-5 mr-2" />
                Manage Templates
              </Button>
            )}
            {canRun && !tableMissing && (
              <Button size="lg" onClick={() => setShowStart(true)}>
                <Plus className="w-5 h-5 mr-2" />
                Start Training
              </Button>
            )}
          </div>
        </div>

        {tableMissing && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <AlertCircle className="w-6 h-6 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900 mb-2">Database Tables Not Found</h3>
                  <p className="text-amber-800 text-sm mb-3">
                    Run <code className="bg-amber-100 px-1.5 py-0.5 rounded">database-migrations/training_checklists.sql</code>
                    {' '}in the Supabase SQL editor to create the checklist tables.
                  </p>
                  <Button
                    onClick={() => window.open('https://supabase.com/dashboard/project/gbllxumuogsncoiaksum/sql/new', '_blank')}
                    variant="outline"
                  >
                    Open Supabase SQL Editor
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <Card><CardContent className="py-12 text-center text-gray-500">Loading...</CardContent></Card>
        ) : !tableMissing && (
          <>
            {/* Available templates */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Available Checklists</h2>
              {templates.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center">
                    <ClipboardList className="w-14 h-14 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No checklist templates yet</p>
                    {isAdmin && (
                      <Button className="mt-4" onClick={() => navigate('/training-checklist-setup')}>
                        <Plus className="w-4 h-4 mr-2" />Create a Template
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {templates.map((t) => (
                    <Card key={t.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t.name}</h3>
                          {t.kind === 'xfire' && <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200">XFire</Badge>}
                          {t.product_line && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">{t.product_line}</Badge>}
                        </div>
                        {t.description && <p className="text-sm text-gray-600 dark:text-gray-300 mb-2 line-clamp-2">{t.description}</p>}
                        <p className="text-xs text-gray-500 mb-3">{t.steps?.length || 0} steps</p>
                        {canRun && (
                          <Button size="sm" variant="outline" onClick={() => { setStartForm((s) => ({ ...s, templateId: t.id })); setShowStart(true); }}>
                            <Plus className="w-4 h-4 mr-1" />Start
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Recent sessions */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Training Sessions</h2>
              {sessions.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-gray-500">No training sessions recorded yet</CardContent></Card>
              ) : (
                <div className="space-y-3">
                  {sessions.map((s) => {
                    const { done, total } = progress(s);
                    return (
                      <Card key={s.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                                  {customerLabel(s.customer) || 'Unknown customer'}
                                </h3>
                                {s.status === 'completed' ? (
                                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />Completed
                                  </Badge>
                                ) : (
                                  <Badge className="bg-amber-100 text-amber-800 border-amber-200 gap-1">
                                    <Clock className="w-3.5 h-3.5" />In progress
                                  </Badge>
                                )}
                                {s.product_line && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">{s.product_line}</Badge>}
                                {s.kind === 'xfire' && <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200">XFire</Badge>}
                              </div>
                              <p className="text-sm text-gray-600 dark:text-gray-300">{s.template_name}</p>
                              <div className="flex gap-3 text-xs text-gray-500 mt-1 flex-wrap">
                                <span>{done}/{total} steps</span>
                                {s.location && <span>{s.location}</span>}
                                {s.trainer_name && <span>SQM: {s.trainer_name}</span>}
                                <span>{new Date(s.training_date).toLocaleDateString()}</span>
                                {s.field_visit_id && <span>Visit: {s.field_visit_id}</span>}
                              </div>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                              <Button variant="outline" size="sm" title="Open" onClick={() => navigate(`/training-checklists/session/${s.id}`)}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              {canRun && (
                                <Button variant="outline" size="sm" title="Delete" onClick={() => handleDeleteSession(s)}>
                                  <Trash2 className="w-4 h-4 text-red-600" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Start-session modal */}
      {showStart && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => !starting && setShowStart(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Start Training Session</h2>
              <button onClick={() => !starting && setShowStart(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Checklist template</label>
                <select
                  value={startForm.templateId}
                  onChange={(e) => setStartForm((s) => ({ ...s, templateId: e.target.value }))}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="">— Select a checklist —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Customer <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={startForm.customer}
                    onChange={(e) => setStartForm((s) => ({ ...s, customer: e.target.value, customerDistrict: '' }))}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                  >
                    <option value="">— Select customer —</option>
                    {customers.map((c) => <option key={c.row_id} value={c.row_id}>{c.customer}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer District</label>
                  <select
                    value={startForm.customerDistrict}
                    onChange={(e) => setStartForm((s) => ({ ...s, customerDistrict: e.target.value }))}
                    disabled={!startForm.customer}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    <option value="">{startForm.customer ? '— Select district —' : '— Pick a customer first —'}</option>
                    {districts.map((d) => <option key={d.row_id} value={d.row_id}>{d.customer_district}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location <span className="text-gray-400 font-normal">(optional)</span></label>
                <Input value={startForm.location} onChange={(e) => setStartForm((s) => ({ ...s, location: e.target.value }))} placeholder="Site / pad / location" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link to field visit (optional)</label>
                <select
                  value={startForm.fieldVisitId}
                  onChange={(e) => setStartForm((s) => ({ ...s, fieldVisitId: e.target.value }))}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="">— Not linked —</option>
                  {visibleTrainingVisits.map((v) => (
                    <option key={v.field_visit_id} value={v.field_visit_id}>
                      {v.field_visit_id}{v.customer ? ` · ${v.customer}` : ''}{v.arrival_date ? ` · ${new Date(v.arrival_date).toLocaleDateString()}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Only Training-purpose field visits are shown
                  {startForm.customer ? ' for the selected customer' : ''}.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setShowStart(false)} disabled={starting}>Cancel</Button>
              <Button onClick={handleStart} disabled={starting}>
                {starting ? 'Starting...' : 'Start Session'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
