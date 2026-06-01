import { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Check, Eraser, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth-context';

/**
 * Canvas-based signature pad. No external deps.
 *
 * Captures a drawn signature, exports it to a PNG, and uploads it via the
 * polymorphic image route (POST /images/:parentTable/:parentRowId) tagged with
 * the given fieldName. On success the parent receives the public URL so it can
 * be stored on the record (e.g. driver_sig_url).
 */
interface SignaturePadProps {
  parentTable: string;       // e.g. 'driver_loads'
  parentRowId: string;       // row_id of the record
  fieldName: string;         // e.g. 'driver_signature'
  label: string;             // e.g. 'Driver'
  baseUrl: string;
  publicAnonKey: string;
  existingUrl?: string | null;
  disabled?: boolean;
  onSaved?: (url: string) => void;
}

export default function SignaturePad({
  parentTable,
  parentRowId,
  fieldName,
  label,
  baseUrl,
  publicAnonKey,
  existingUrl,
  disabled = false,
  onSaved,
}: SignaturePadProps) {
  const { accessToken } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(existingUrl ?? null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setSavedUrl(existingUrl ?? null);
  }, [existingUrl]);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  useEffect(() => {
    initCanvas();
  }, [initCanvas]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    drawing.current = true;
    hasDrawn.current = true;
    setDirty(true);
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current!.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
    setDirty(false);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!hasDrawn.current) {
      toast.error('Please draw a signature first');
      return;
    }
    setSaving(true);
    try {
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!blob) throw new Error('Could not capture signature');

      const file = new File([blob], `${fieldName}.png`, { type: 'image/png' });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fieldName', fieldName);
      formData.append('caption', `${label} signature`);

      const url = `${baseUrl}/images/${encodeURIComponent(parentTable)}/${encodeURIComponent(parentRowId)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken ?? publicAnonKey}` },
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${resp.status})`);
      }
      const data = await resp.json();
      setSavedUrl(data.url);
      setDirty(false);
      onSaved?.(data.url);
      toast.success(`${label} signature saved`);
    } catch (error: any) {
      console.error('Signature save error:', error);
      toast.error(error.message || 'Failed to save signature');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
        {savedUrl && !dirty && (
          <span className="inline-flex items-center text-xs text-green-700 dark:text-green-400">
            <Check className="w-3.5 h-3.5 mr-1" /> Signed
          </span>
        )}
      </div>

      {savedUrl && !dirty ? (
        <div className="border border-gray-200 dark:border-gray-700 rounded-md bg-white p-2">
          <img src={savedUrl} alt={`${label} signature`} className="h-24 object-contain mx-auto" />
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          width={500}
          height={150}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          className={`w-full h-[150px] rounded-md border border-gray-300 dark:border-gray-600 bg-white touch-none ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-crosshair'
          }`}
        />
      )}

      {!disabled && (
        <div className="flex gap-2">
          {savedUrl && !dirty ? (
            <Button type="button" variant="outline" size="sm" onClick={() => { setDirty(true); setTimeout(() => { initCanvas(); clear(); }, 0); }}>
              <Eraser className="w-4 h-4 mr-1" /> Re-sign
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={clear} disabled={saving}>
                <Eraser className="w-4 h-4 mr-1" /> Clear
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                Save signature
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
