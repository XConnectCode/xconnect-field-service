/**
 * IncidentForm.tsx
 * Full create/edit dialog for the incidents table.
 * Schema-synced with live Supabase incidents table.
 */

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { toast } from 'sonner';
import { Upload, X, Loader2 } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function F({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs font-semibold text-gray-600 mb-1 block">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="col-span-2 pt-2 pb-1 border-b border-gray-100">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
        {title}
      </span>
    </div>
  );
}

/**
 * Extract distinct, sorted option strings from lists table rows.
 */
function opts(listItems: any[], col: string): string[] {
  return Array.from(
    new Set(
      listItems
        .map((i: any) => i[col] as string | null)
        .filter((v): v is string => !!v)
    )
  ).sort();
}

function Sel({
  name,
  defaultValue,
  children,
}: {
  name: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue || ''}
      className="w-full border border-gray-300 rounded-md p-2 text-sm"
    >
      {children}
    </select>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  incident?: any;
  currentUser?: any;
}

export default function IncidentForm({
  open,
  onClose,
  onSaved,
  incident,
  currentUser,
}: Props) {
  const editing = !!incident;

  // Reference data
  const [customers, setCustomers] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [sqmReps, setSqmReps] = useState<string[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [listItems, setListItems] = useState<any[]>([]);
  const [epCompanies, setEpCompanies] = useState<string[]>([]);

  // Form state
  const [custId, setCustId] = useState('');
  const [distId, setDistId] = useState('');
  const [saving, setSaving] = useState(false);
  const [nextEventId, setNextEventId] = useState<string>('');

  // Image state — two fixed slots, kept compatible with AppSheet's image1/image2 columns.
  const [images, setImages] = useState<{ img1: string; img2: string }>({
    img1: '',
    img2: '',
  });
  const [uploadingSlot, setUploadingSlot] = useState<1 | 2 | null>(null);

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Fetch next available Event ID
  useEffect(() => {
    if (!open || editing) return;

    supabase
      .from('incidents')
      .select('event_id')
      .order('event_id', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const maxId = (data || []).reduce((max, row: any) => {
          const n = parseInt(row.event_id);
          return !isNaN(n) && n > max ? n : max;
        }, 0);
        setNextEventId(String(maxId + 1));
      });
  }, [open, editing]);

  // Load reference tables once per open
  useEffect(() => {
    if (!open) return;

    Promise.all([
      supabase.from('customers').select('row_id,customer').order('customer'),
      supabase.from('sqm').select('sq_manager').order('sq_manager'),
      supabase.from('vendors').select('row_id,vendor').order('vendor'),
      supabase.from('lists').select('*'),
      supabase.from('ep').select('operating_company').order('operating_company'),
    ]).then(([c, s, v, l, e]) => {
      setCustomers(c.data || []);
      setSqmReps(
        (s.data || [])
          .map((r: any) => r.sq_manager as string)
          .filter((r: string) => r && r !== 'Pre-Tracking')
      );
      setVendors(v.data || []);
      setListItems(l.data || []);
      setEpCompanies((e.data || []).map((r: any) => r.operating_company as string));
    });
  }, [open]);

  // Load districts when customer changes
  useEffect(() => {
    if (!custId) {
      setDistricts([]);
      setDistId('');
      return;
    }

    supabase
      .from('districts')
      .select('row_id,customer_district')
      .eq('customer', custId)
      .order('customer_district')
      .then(({ data }) => setDistricts(data || []));
  }, [custId]);

  // Pre-fill when editing
  useEffect(() => {
    if (incident) {
      setCustId(incident.customer || '');
      setDistId(incident.customer_district || '');
      setImages({
        img1: incident.image1 || '',
        img2: incident.image2 || '',
      });
    } else {
      setCustId('');
      setDistId('');
      setImages({ img1: '', img2: '' });
    }
  }, [incident, open]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleImageUpload = async (file: File, slot: 1 | 2) => {
    setUploadingSlot(slot);
    try {
      if (!file.type.startsWith('image/')) {
        toast.error('Please select an image file');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error('Image must be less than 10MB');
        return;
      }

      const ext = file.name.split('.').pop();
      const filePath = `incidents/img-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;

      const { error } = await supabase.storage
        .from('Native Files')
        .upload(filePath, file);

      if (error) throw error;

      const {
        data: { publicUrl },
      } = supabase.storage.from('Native Files').getPublicUrl(filePath);

      setImages((prev) => ({ ...prev, [`img${slot}`]: publicUrl }));
      toast.success(`Image ${slot} uploaded`);
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploadingSlot(null);
    }
  };

  const clearImage = (slot: 1 | 2) => {
    setImages((prev) => ({ ...prev, [`img${slot}`]: '' }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);

    const fd = new FormData(e.currentTarget);

    const payload: Record<string, any> = {
      date_incident: fd.get('date_incident') || null,
      incident_status: fd.get('incident_status') || null,
      incident_severity: fd.get('incident_severity') || null,
      xc_caused: fd.get('xc_caused') || null,
      event_category: fd.get('event_category') || null,
      product_line: fd.get('product_line') || null,
      firing_system: fd.get('firing_system') || null,
      field_facility: fd.get('field_facility') || null,
      customer: custId || null,
      customer_district: distId || null,
      xc_rep: fd.get('xc_rep') || null,
      customer_rep: fd.get('customer_rep') || null,
      ep_rep: fd.get('ep_rep') || null,
      operating_company: fd.get('operating_company') || null,
      xc_district: fd.get('xc_district') || null,
      well_name: fd.get('well_name') || null,
      stage_number: fd.get('stage_number') || null,
      so_number: fd.get('so_number') || null,
      field_visit_id: fd.get('field_visit_id') || null,
      failed_component: fd.get('failed_component') || null,
      failure_type: fd.get('failure_type') || null,
      vendor: fd.get('vendor') || null,
      vendor_caused: fd.get('vendor_caused') || null,
      incident_description: fd.get('incident_description') || null,
      investigation: fd.get('investigation') || null,
      root_cause: fd.get('root_cause') || null,
      corrective_action: fd.get('corrective_action') || null,
      preventive_action: fd.get('preventive_action') || null,
      action_assigned_to: fd.get('action_assigned_to') || null,
      action_due_date: fd.get('action_due_date') || null,
      action_status: fd.get('action_status') || null,
      closed_date: fd.get('closed_date') || null,
      closed_by: fd.get('closed_by') || null,
      report_version: fd.get('report_version') || null,
      notes: fd.get('notes') || null,
      image1: images.img1 || null,
      image2: images.img2 || null,
    };

    if (!editing) {
      payload.event_id = fd.get('event_id') || '';
    }

    try {
      const { error } = editing
        ? await supabase
            .from('incidents')
            .update(payload)
            .eq('row_id', incident.row_id)
        : await supabase.from('incidents').insert(payload);

      if (error) throw new Error(error.message);

      toast.success(`Incident ${editing ? 'updated' : 'created'} successfully`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save incident');
    } finally {
      setSaving(false);
    }
  };

  const uniqueFailureTypes = [
    ...new Map(
      listItems
        .filter((l: any) => l.failure_type)
        .map((l: any) => [l.failure_type, l] as const)
    ).values(),
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit Incident #${incident.event_id}`
              : 'Report New Incident'}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-2 gap-x-6 gap-y-4 mt-2"
        >
          {/* ── Incident Info ── */}
          <Section title="Incident Info" />

          {!editing && (
            <F label="Event ID" required>
              <Input
                name="event_id"
                required
                value={nextEventId}
                onChange={(e) => setNextEventId(e.target.value)}
                className="font-mono"
              />
            </F>
          )}

          <F label="Incident Date" required>
            <Input
              name="date_incident"
              type="date"
              defaultValue={incident?.date_incident || ''}
              required
            />
          </F>

          <F label="Status">
            <Sel
              name="incident_status"
              defaultValue={incident?.incident_status || 'Open'}
            >
              <option value="">— Select —</option>
              {opts(listItems, 'incident_status').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          <F label="Severity">
            <Sel
              name="incident_severity"
              defaultValue={incident?.incident_severity || ''}
            >
              <option value="">— Select —</option>
              {opts(listItems, 'incident_severity').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          <F label="XC Caused">
            <Sel name="xc_caused" defaultValue={incident?.xc_caused || ''}>
              <option value="">— Select —</option>
              {opts(listItems, 'xc_caused').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          <F label="Event Category">
            <Sel
              name="event_category"
              defaultValue={incident?.event_category || ''}
            >
              <option value="">— Select —</option>
              {opts(listItems, 'event_category').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          <F label="Field or Facility">
            <Sel
              name="field_facility"
              defaultValue={incident?.field_facility || 'Field'}
            >
              <option value="">— Select —</option>
              {opts(listItems, 'field_facility').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          <F label="Report Version">
            <Sel
              name="report_version"
              defaultValue={incident?.report_version || 'Preliminary'}
            >
              <option value="">— Select —</option>
              {opts(listItems, 'report_version').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          {/* ── Customer / District ── */}
          <Section title="Customer" />

          <F label="Customer" required>
            <select
              value={custId}
              onChange={(e) => {
                setCustId(e.target.value);
                setDistId('');
              }}
              className="w-full border border-gray-300 rounded-md p-2 text-sm"
              required
            >
              <option value="">— Select customer —</option>
              {customers.map((c: any) => (
                <option key={c.row_id} value={c.row_id}>
                  {c.customer}
                </option>
              ))}
            </select>
          </F>

          <F label="District">
            <select
              value={distId}
              onChange={(e) => setDistId(e.target.value)}
              disabled={!custId}
              className="w-full border border-gray-300 rounded-md p-2 text-sm"
            >
              <option value="">— All districts —</option>
              {districts.map((d: any) => (
                <option key={d.row_id} value={d.row_id}>
                  {d.customer_district}
                </option>
              ))}
            </select>
          </F>

          <F label="Operating Company">
            <Sel
              key={`op-${incident?.row_id}-${epCompanies.length}`}
              name="operating_company"
              defaultValue={incident?.operating_company || ''}
            >
              <option value="">— Select —</option>
              {epCompanies.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          {/* ── Personnel ── */}
          <Section title="Personnel" />

          <F label="XC Rep">
            <Sel
              key={`xcrep-${incident?.row_id}-${sqmReps.length}`}
              name="xc_rep"
              defaultValue={incident?.xc_rep || currentUser?.name || ''}
            >
              <option value="">— Select —</option>
              {sqmReps.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Sel>
          </F>

          <F label="XC District">
            <Input
              name="xc_district"
              defaultValue={incident?.xc_district || ''}
              placeholder="e.g. Permian Basin"
            />
          </F>

          <F label="Customer Rep">
            <Input name="customer_rep" defaultValue={incident?.customer_rep || ''} />
          </F>

          <F label="EP Rep">
            <Input name="ep_rep" defaultValue={incident?.ep_rep || ''} />
          </F>

          {/* ── Job Details ── */}
          <Section title="Job Details" />

          <F label="Well Name">
            <Input name="well_name" defaultValue={incident?.well_name || ''} />
          </F>

          <F label="Stage #">
            <Input
              name="stage_number"
              defaultValue={incident?.stage_number || ''}
            />
          </F>

          <F label="SO #">
            <Input name="so_number" defaultValue={incident?.so_number || ''} />
          </F>

          <F label="Field Visit ID">
            <Input
              name="field_visit_id"
              defaultValue={incident?.field_visit_id || ''}
              placeholder="Links to a field visit"
            />
          </F>

          {/* ── Technical Details ── */}
          <Section title="Technical Details" />

          <F label="Product Line">
            <Sel
              name="product_line"
              defaultValue={incident?.product_line || ''}
            >
              <option value="">— Select —</option>
              {opts(listItems, 'xc_products').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          <F label="Firing System">
            <Sel
              name="firing_system"
              defaultValue={incident?.firing_system || ''}
            >
              <option value="">— Select —</option>
              {opts(listItems, 'firing_system').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          <F label="Failed Component">
            <Sel
              key={`fc-${incident?.row_id}-${listItems.length}`}
              name="failed_component"
              defaultValue={incident?.failed_component || ''}
            >
              <option value="">— Select —</option>
              {listItems
                .filter((l: any) => l.failed_component)
                .map((l: any) => (
                  <option key={l.row_id} value={l.row_id}>
                    {l.failed_component}
                  </option>
                ))}
            </Sel>
          </F>

          <F label="Failure Type">
            <Sel
              key={`ft-${incident?.row_id}-${listItems.length}`}
              name="failure_type"
              defaultValue={incident?.failure_type || ''}
            >
              <option value="">— Select —</option>
              {uniqueFailureTypes.map((l: any) => (
                <option key={l.row_id} value={l.row_id}>
                  {l.failure_type}
                </option>
              ))}
            </Sel>
          </F>

          <F label="Vendor">
            <Sel
              key={`vnd-${incident?.row_id}-${vendors.length}`}
              name="vendor"
              defaultValue={incident?.vendor || ''}
            >
              <option value="">— Select —</option>
              {vendors.map((v: any) => (
                <option key={v.row_id} value={v.row_id}>
                  {v.vendor}
                </option>
              ))}
            </Sel>
          </F>

          <F label="Vendor Caused">
            <Sel
              name="vendor_caused"
              defaultValue={incident?.vendor_caused || ''}
            >
              <option value="">— Select —</option>
              {opts(listItems, 'vendor_caused').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          {/* ── Narrative ── */}
          <Section title="Narrative" />

          <div className="col-span-2">
            <F label="Incident Description">
              <Textarea
                name="incident_description"
                rows={3}
                defaultValue={incident?.incident_description || ''}
                placeholder="What happened?"
              />
            </F>
          </div>

          <div className="col-span-2">
            <F label="Investigation">
              <Textarea
                name="investigation"
                rows={3}
                defaultValue={incident?.investigation || ''}
                placeholder="What was found during investigation?"
              />
            </F>
          </div>

          <div className="col-span-2">
            <F label="Root Cause">
              <Textarea
                name="root_cause"
                rows={3}
                defaultValue={incident?.root_cause || ''}
                placeholder="Root cause analysis"
              />
            </F>
          </div>

          {/* ── Corrective / Preventive Actions ── */}
          <Section title="Corrective & Preventive Actions" />

          <div className="col-span-2">
            <F label="Corrective Action">
              <Textarea
                name="corrective_action"
                rows={3}
                defaultValue={incident?.corrective_action || ''}
                placeholder="Actions taken to correct the issue"
              />
            </F>
          </div>

          <div className="col-span-2">
            <F label="Preventive Action">
              <Textarea
                name="preventive_action"
                rows={3}
                defaultValue={incident?.preventive_action || ''}
                placeholder="Actions taken to prevent recurrence"
              />
            </F>
          </div>

          <F label="Action Assigned To">
            <Sel
              key={`aa-${incident?.row_id}-${sqmReps.length}`}
              name="action_assigned_to"
              defaultValue={incident?.action_assigned_to || ''}
            >
              <option value="">— Select —</option>
              {sqmReps.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Sel>
          </F>

          <F label="Action Due Date">
            <Input
              name="action_due_date"
              type="date"
              defaultValue={incident?.action_due_date || ''}
            />
          </F>

          <F label="Action Status">
            <Sel
              name="action_status"
              defaultValue={incident?.action_status || ''}
            >
              <option value="">— Select —</option>
              {opts(listItems, 'action_status').map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Sel>
          </F>

          {/* ── Closure ── */}
          <Section title="Closure" />

          <F label="Closed Date">
            <Input
              name="closed_date"
              type="date"
              defaultValue={incident?.closed_date || ''}
            />
          </F>

          <F label="Closed By">
            <Sel
              key={`cb-${incident?.row_id}-${sqmReps.length}`}
              name="closed_by"
              defaultValue={incident?.closed_by || ''}
            >
              <option value="">— Select —</option>
              {sqmReps.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Sel>
          </F>

          {/* ── Evidence Images ── */}
          <Section title="Evidence Images" />

          {([1, 2] as const).map((slot) => {
            const url = slot === 1 ? images.img1 : images.img2;
            const uploading = uploadingSlot === slot;

            return (
              <div key={slot}>
                <Label className="text-xs font-semibold text-gray-600 mb-2 block">
                  Image {slot}
                </Label>
                {url ? (
                  <div className="relative inline-block group">
                    <img
                      src={url}
                      alt={`Evidence ${slot}`}
                      className="w-48 h-32 object-cover rounded-lg border border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => clearImage(slot)}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleImageUpload(f, slot);
                      }}
                    />
                    {uploading ? (
                      <div className="flex flex-col items-center gap-1">
                        <Loader2 className="w-7 h-7 text-gray-400 animate-spin" />
                        <span className="text-xs text-gray-500">Uploading…</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <Upload className="w-7 h-7 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          Click to upload
                        </span>
                        <span className="text-xs text-gray-400">
                          PNG, JPG up to 10MB
                        </span>
                      </div>
                    )}
                  </label>
                )}
              </div>
            );
          })}

          {/* ── Notes ── */}
          <Section title="Notes" />

          <div className="col-span-2">
            <F label="Notes">
              <Textarea name="notes" rows={2} defaultValue={incident?.notes || ''} />
            </F>
          </div>

          {/* ── Actions ── */}
          <div className="col-span-2 flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Update Incident' : 'Submit Incident'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
