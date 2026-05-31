import { useEffect, useMemo, useState } from 'react';
import { Loader2, ImageIcon, FileText } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import type { ImageRecord } from './ImageUpload';
import { getBearerToken } from '../lib/authHeaders';
import {
  buildDefaultSelection,
  selectionToPdfImages,
  type IncidentReportImage,
  type PickerSelectionState as SelectionState,
} from '../lib/incidentPdfImages';

export type { SelectionState };

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen images (may be empty) when the user confirms. */
  onConfirm: (selected: IncidentReportImage[]) => void;
  /** Incident row_id used to fetch images from /images/incidents/:row_id */
  incidentRowId: string;
  baseUrl: string;
  publicAnonKey: string;
  /** Label for the action button (e.g. "Generate Preliminary Report") */
  actionLabel: string;
  generating?: boolean;
}

export default function IncidentPdfImagePicker({
  open,
  onClose,
  onConfirm,
  incidentRowId,
  baseUrl,
  publicAnonKey,
  actionLabel,
  generating = false,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [state, setState] = useState<SelectionState>({});

  useEffect(() => {
    if (!open || !incidentRowId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url = `${baseUrl}/images/incidents/${encodeURIComponent(incidentRowId)}`;
        // Forward the live session token; the /images route requires auth.
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${await getBearerToken()}` },
        });
        if (!resp.ok) throw new Error(`Failed to load images (${resp.status})`);
        const data = await resp.json();
        if (cancelled) return;
        const files: ImageRecord[] = Array.isArray(data.files) ? data.files : [];
        setImages(files);
        setState(buildDefaultSelection(files));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load images');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, incidentRowId, baseUrl, publicAnonKey]);

  const selectedCount = useMemo(
    () => Object.values(state).filter(s => s.selected).length,
    [state],
  );

  const toggleAll = (next: boolean) => {
    setState(prev => {
      const out: SelectionState = { ...prev };
      Object.keys(out).forEach(k => {
        out[k] = { ...out[k], selected: next };
      });
      return out;
    });
  };

  const toggleOne = (id: string, next: boolean) => {
    setState(prev => ({ ...prev, [id]: { ...prev[id], selected: next } }));
  };

  const editCaption = (id: string, caption: string) => {
    setState(prev => ({ ...prev, [id]: { ...prev[id], caption } }));
  };

  const handleConfirm = () => {
    onConfirm(selectionToPdfImages(images, state));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-500" />
            Choose Images for Report
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            Select which evidence images to include in the generated PDF and
            edit captions as needed. You can also generate the report with no
            images attached.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">Loading images…</span>
            </div>
          )}

          {error && !loading && (
            <div className="text-sm text-red-600 py-2">{error}</div>
          )}

          {!loading && !error && images.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500">
              <ImageIcon className="w-10 h-10 mb-2 text-gray-400" />
              <p className="text-sm">No evidence images attached to this incident.</p>
              <p className="text-xs text-gray-400 mt-1">
                The PDF will be generated without a Visual Evidence section.
              </p>
            </div>
          )}

          {!loading && !error && images.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-600 pb-2 border-b">
                <span>
                  {selectedCount} of {images.length} selected
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => toggleAll(true)}
                    className="text-blue-600 hover:underline disabled:opacity-50"
                    disabled={selectedCount === images.length}
                  >
                    Select all
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => toggleAll(false)}
                    className="text-blue-600 hover:underline disabled:opacity-50"
                    disabled={selectedCount === 0}
                  >
                    Deselect all
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {images.map((img, idx) => {
                  const id = img.id;
                  if (!id) return null;
                  const row = state[id] || { selected: false, caption: '' };
                  return (
                    <div
                      key={id}
                      className={`flex gap-3 items-start p-3 rounded-lg border transition-colors ${
                        row.selected ? 'bg-blue-50/40 border-blue-200' : 'bg-white border-gray-200'
                      }`}
                    >
                      <Checkbox
                        checked={row.selected}
                        onCheckedChange={(v) => toggleOne(id, v === true)}
                        className="mt-2"
                      />
                      <img
                        src={img.url}
                        alt={img.caption ?? img.fieldName ?? `Image ${idx + 1}`}
                        className="w-24 h-24 object-cover rounded border border-gray-200 shrink-0 bg-gray-50"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                          Caption
                        </label>
                        <Input
                          value={row.caption}
                          onChange={(e) => editCaption(id, e.target.value)}
                          placeholder={`Image ${idx + 1}`}
                          disabled={!row.selected}
                          className="text-sm"
                        />
                        {img.fieldName && (
                          <p className="text-[11px] text-gray-400">
                            Field: {img.fieldName}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-gray-50 shrink-0 flex flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={generating}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={generating || loading}>
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Generating…
              </>
            ) : (
              actionLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
