/**
 * ManageLists.tsx — Admin screen to manage dropdown options (the `lists` table).
 *
 * Every incident / field-visit dropdown is data-driven from the `lists` table:
 * each category is a column, each option is a distinct non-empty value across
 * rows. This page lets an admin add / rename / delete those options without SQL.
 *
 * Writes go through the admin-gated edge routes (RLS blocks direct client
 * writes to `lists`):
 *   GET    /lists                       → all rows
 *   POST   /lists       {category,value}
 *   PUT    /lists/rename{category,oldValue,newValue}  (cascades to records)
 *   GET    /lists/usage ?category=&value=
 *   DELETE /lists       {category,value} (blocked if still in use)
 */

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Plus, Pencil, Trash2, Check, X, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { projectId } from '../../../utils/supabase/info';
import { getAuthHeaders } from '../lib/authHeaders';

const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

// Category column -> friendly label. Order here = display order.
const CATEGORIES: { key: string; label: string; help?: string }[] = [
  { key: 'xc_products',       label: 'Product Line',     help: 'Incident → Product Line' },
  { key: 'event_category',    label: 'Event Category',   help: 'Incident → Event Category' },
  { key: 'firing_system',     label: 'Firing System',    help: 'Incident → Firing System' },
  { key: 'incident_severity', label: 'Incident Severity' },
  { key: 'incident_status',   label: 'Incident Status' },
  { key: 'xc_caused',         label: 'XC Caused' },
  { key: 'vendor_caused',     label: 'Vendor Caused' },
  { key: 'report_version',    label: 'Report Version' },
  { key: 'field_facility',    label: 'Field / Facility', help: 'Field Visit → Field or Facility' },
  { key: 'visit_purpose',     label: 'Visit Purpose',    help: 'Field Visit → Purpose' },
  { key: 'failure_type',      label: 'Failure Type' },
  { key: 'failed_component',  label: 'Failed Component' },
  { key: 'action_status',     label: 'Action Status' },
];

interface ListRow { row_id: string; [col: string]: any; }

export default function ManageLists() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Add-option inputs, keyed per category.
  const [addValues, setAddValues] = useState<Record<string, string>>({});
  // Inline rename state: which option is being edited + its draft text.
  const [editing, setEditing] = useState<{ category: string; oldValue: string } | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // Delete confirm dialog state.
  const [deleteTarget, setDeleteTarget] = useState<
    { category: string; label: string; value: string; usage: number; scanned: boolean } | null
  >(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/lists`, { headers: await getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load lists');
      setRows(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load lists');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Distinct sorted options per category, derived from the raw rows.
  const optionsByCategory = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const { key } of CATEGORIES) {
      const set = new Set<string>();
      for (const r of rows) {
        const v = r[key];
        if (v != null && String(v).trim() !== '') set.add(String(v).trim());
      }
      map[key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [rows]);

  const addOption = async (category: string) => {
    const value = (addValues[category] || '').trim();
    if (!value) return;
    setBusy(true);
    try {
      const res = await fetch(`${baseUrl}/lists`, {
        method: 'POST',
        headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ category, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add option');
      toast.success(`Added "${value}"`);
      setAddValues((p) => ({ ...p, [category]: '' }));
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add option');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (category: string, oldValue: string) => {
    setEditing({ category, oldValue });
    setEditDraft(oldValue);
  };
  const cancelEdit = () => { setEditing(null); setEditDraft(''); };

  const saveEdit = async () => {
    if (!editing) return;
    const newValue = editDraft.trim();
    if (!newValue || newValue === editing.oldValue) { cancelEdit(); return; }
    setBusy(true);
    try {
      const res = await fetch(`${baseUrl}/lists/rename`, {
        method: 'PUT',
        headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ category: editing.category, oldValue: editing.oldValue, newValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rename option');
      const n = data.updatedRecords || 0;
      toast.success(n > 0 ? `Renamed — updated ${n} record${n === 1 ? '' : 's'}` : 'Renamed');
      cancelEdit();
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to rename option');
    } finally {
      setBusy(false);
    }
  };

  // Ask the server how many records use the value, then open the confirm dialog.
  const requestDelete = async (category: string, label: string, value: string) => {
    setBusy(true);
    try {
      const url = `${baseUrl}/lists/usage?category=${encodeURIComponent(category)}&value=${encodeURIComponent(value)}`;
      const res = await fetch(url, { headers: await getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to check usage');
      setDeleteTarget({ category, label, value, usage: data.usage || 0, scanned: !!data.scanned });
    } catch (err: any) {
      toast.error(err.message || 'Failed to check usage');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`${baseUrl}/lists`, {
        method: 'DELETE',
        headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ category: deleteTarget.category, value: deleteTarget.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete option');
      toast.success(`Deleted "${deleteTarget.value}"`);
      setDeleteTarget(null);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete option');
    } finally {
      setBusy(false);
    }
  };

  if (user?.role !== 'admin') {
    return <div className="p-8 text-gray-600 dark:text-gray-300">Admins only.</div>;
  }
  if (loading) return <div className="p-8">Loading…</div>;

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ListChecks className="w-7 h-7" /> Manage Lists
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Add, rename, or remove the options that appear in incident and field-visit dropdowns.
            Renaming an option updates existing records automatically. An option that is still used
            by records cannot be deleted until those records are reassigned.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {CATEGORIES.map(({ key, label, help }) => {
            const options = optionsByCategory[key] || [];
            return (
              <Card key={key}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{label}</span>
                    <span className="text-xs font-normal text-gray-400">{options.length} option{options.length === 1 ? '' : 's'}</span>
                  </CardTitle>
                  {help && <p className="text-xs text-gray-400 -mt-1">{help}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Existing options */}
                  <div className="space-y-1.5">
                    {options.length === 0 && (
                      <p className="text-sm text-gray-400">No options yet.</p>
                    )}
                    {options.map((opt) => {
                      const isEditing = editing?.category === key && editing?.oldValue === opt;
                      return (
                        <div
                          key={opt}
                          className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1.5"
                        >
                          {isEditing ? (
                            <>
                              <Input
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                className="h-8 flex-1"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                                  if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                                }}
                              />
                              <Button size="sm" variant="ghost" disabled={busy} onClick={saveEdit} title="Save">
                                <Check className="w-4 h-4 text-green-600" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit} title="Cancel">
                                <X className="w-4 h-4 text-gray-400" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1 text-sm text-gray-800 dark:text-gray-100 truncate" title={opt}>{opt}</span>
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => startEdit(key, opt)} title="Rename">
                                <Pencil className="w-3.5 h-3.5 text-gray-400 hover:text-blue-600" />
                              </Button>
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => requestDelete(key, label, opt)} title="Delete">
                                <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-600" />
                              </Button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Add new option */}
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      value={addValues[key] || ''}
                      onChange={(e) => setAddValues((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder={`Add ${label} option…`}
                      className="h-9"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(key); } }}
                    />
                    <Button size="sm" disabled={busy || !(addValues[key] || '').trim()} onClick={() => addOption(key)}>
                      <Plus className="w-4 h-4 mr-1" /> Add
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.value}”?</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-4">
              {deleteTarget.usage > 0 ? (
                <p className="text-sm text-red-600">
                  This option is still used by <strong>{deleteTarget.usage}</strong> record
                  {deleteTarget.usage === 1 ? '' : 's'}. Reassign or rename those records before
                  deleting it.
                </p>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {deleteTarget.scanned
                    ? 'No records use this option. It is safe to remove from the dropdown.'
                    : 'This option will be removed from the dropdown.'}
                </p>
              )}
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  disabled={busy || deleteTarget.usage > 0}
                  onClick={confirmDelete}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
