import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Plus, Trash2, GripVertical, Save, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth-context';
import {
  listTemplates, saveTemplate, deleteTemplate, isMissingTableError,
  type ChecklistTemplate, type ChecklistStep,
} from '../lib/trainingChecklists';

const PRODUCT_LINES = ['XC', 'RAIL', 'DSX', 'LynX', 'XC Oriented', 'XC 2.75"', 'ReConnect', 'mRAIL'];

function newStepId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

interface EditState {
  id?: string;
  name: string;
  kind: 'product' | 'xfire' | 'general';
  product_line: string;
  description: string;
  steps: ChecklistStep[];
  active: boolean;
}

const blank: EditState = { name: '', kind: 'product', product_line: '', description: '', steps: [], active: true };

export default function TrainingChecklistSetup() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);

  const [editing, setEditing] = useState<EditState | null>(null);
  const [newStepText, setNewStepText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const tpls = await listTemplates(true);
      setTemplates(tpls);
      setTableMissing(false);
    } catch (err: any) {
      if (isMissingTableError(err)) setTableMissing(true);
      else toast.error('Failed to load templates');
    }
    setLoading(false);
  };

  const startNew = () => { setEditing({ ...blank }); setNewStepText(''); };
  const startEdit = (t: ChecklistTemplate) => {
    setEditing({
      id: t.id,
      name: t.name,
      kind: (t.kind as any) || 'product',
      product_line: t.product_line || '',
      description: t.description || '',
      steps: t.steps || [],
      active: t.active,
    });
    setNewStepText('');
  };

  const addStep = () => {
    const text = newStepText.trim();
    if (!text || !editing) return;
    setEditing({ ...editing, steps: [...editing.steps, { id: newStepId(), text }] });
    setNewStepText('');
  };

  const removeStep = (sid: string) => {
    if (!editing) return;
    setEditing({ ...editing, steps: editing.steps.filter((s) => s.id !== sid) });
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    if (!editing) return;
    const arr = [...editing.steps];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    setEditing({ ...editing, steps: arr });
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error('Enter a template name'); return; }
    if (editing.steps.length === 0) { toast.error('Add at least one step'); return; }
    setSaving(true);
    try {
      await saveTemplate({
        id: editing.id,
        name: editing.name.trim(),
        kind: editing.kind,
        product_line: editing.kind === 'product' ? (editing.product_line || null) : null,
        description: editing.description.trim() || null,
        steps: editing.steps,
        active: editing.active,
        created_by: user?.id || null,
      });
      toast.success(editing.id ? 'Template updated' : 'Template created');
      setEditing(null);
      fetchAll();
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    }
    setSaving(false);
  };

  const handleDelete = async (t: ChecklistTemplate) => {
    if (!confirm(`Delete template "${t.name}"? Existing sessions are kept.`)) return;
    try {
      await deleteTemplate(t.id);
      toast.success('Template deleted');
      fetchAll();
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-800/50">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/training-checklists')} className="-ml-1 text-gray-600 dark:text-gray-300">
          <ArrowLeft className="w-4 h-4 mr-1" />Back to Training Checklists
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Manage Checklist Templates</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Define training checklists per product line or XFire software</p>
          </div>
          {!editing && !tableMissing && (
            <Button size="lg" onClick={startNew}><Plus className="w-5 h-5 mr-2" />New Template</Button>
          )}
        </div>

        {tableMissing && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6 text-amber-800 text-sm">
              The checklist tables don't exist yet. Run
              <code className="bg-amber-100 px-1.5 py-0.5 rounded mx-1">database-migrations/training_checklists.sql</code>
              in the Supabase SQL editor.
            </CardContent>
          </Card>
        )}

        {/* Editor */}
        {editing && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{editing.id ? 'Edit Template' : 'New Template'}</CardTitle>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template name</label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. XC Gun System Training" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                  <select
                    value={editing.kind}
                    onChange={(e) => setEditing({ ...editing, kind: e.target.value as any })}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                  >
                    <option value="product">Gun System Product Line</option>
                    <option value="xfire">XFire Panel Software</option>
                    <option value="general">General</option>
                  </select>
                </div>
                {editing.kind === 'product' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Product line</label>
                    <select
                      value={editing.product_line}
                      onChange={(e) => setEditing({ ...editing, product_line: e.target.value })}
                      className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                    >
                      <option value="">— Select —</option>
                      {PRODUCT_LINES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description (optional)</label>
                <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Short description" />
              </div>

              {/* Steps editor */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Steps</label>
                <div className="space-y-2 mb-3">
                  {editing.steps.map((s, idx) => (
                    <div key={s.id} className="flex items-center gap-2 p-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                      <div className="flex flex-col">
                        <button onClick={() => moveStep(idx, -1)} className="text-gray-400 hover:text-gray-700 leading-none text-xs">▲</button>
                        <button onClick={() => moveStep(idx, 1)} className="text-gray-400 hover:text-gray-700 leading-none text-xs">▼</button>
                      </div>
                      <GripVertical className="w-4 h-4 text-gray-300" />
                      <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{s.text}</span>
                      <button onClick={() => removeStep(s.id)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  {editing.steps.length === 0 && <p className="text-sm text-gray-400">No steps yet — add some below.</p>}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newStepText}
                    onChange={(e) => setNewStepText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }}
                    placeholder="Add a step and press Enter"
                  />
                  <Button variant="outline" onClick={addStep}><Plus className="w-4 h-4" /></Button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="w-4 h-4 accent-blue-600" />
                Active (available for new sessions)
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving}><Save className="w-4 h-4 mr-2" />{saving ? 'Saving...' : 'Save Template'}</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Template list */}
        {!editing && (loading ? (
          <Card><CardContent className="py-12 text-center text-gray-500">Loading...</CardContent></Card>
        ) : !tableMissing && (
          <div className="space-y-3">
            {templates.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-gray-500">No templates yet</CardContent></Card>
            ) : templates.map((t) => (
              <Card key={t.id}>
                <CardContent className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t.name}</h3>
                      {t.kind === 'xfire' && <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200">XFire</Badge>}
                      {t.product_line && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">{t.product_line}</Badge>}
                      {!t.active && <Badge className="bg-gray-100 text-gray-600 border-gray-300">Inactive</Badge>}
                    </div>
                    {t.description && <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">{t.description}</p>}
                    <p className="text-xs text-gray-500">{t.steps?.length || 0} steps</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button variant="outline" size="sm" onClick={() => startEdit(t)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="outline" size="sm" onClick={() => handleDelete(t)}><Trash2 className="w-4 h-4 text-red-600" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
