import { useEffect, useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';
import type { ImageRecord } from './ImageUpload';

/**
 * Read-only gallery for any polymorphic parent record.
 *
 * Fetches GET /images/:parentTable/:parentRowId and renders a signed-URL grid.
 *
 * Example:
 *   <RecordImages
 *     parentTable="incidents"
 *     parentRowId={incident.row_id}
 *     baseUrl={baseUrl}
 *     publicAnonKey={publicAnonKey}
 *   />
 */

interface RecordImagesProps {
  parentTable: string;
  parentRowId: string;
  baseUrl: string;
  publicAnonKey: string;

  /** Group thumbnails by field_name (e.g. Image1 / Image2 / Pictures) */
  groupByField?: boolean;

  /** Custom empty-state message */
  emptyMessage?: string;

  /** Override the heading shown above the gallery. Pass null to hide. */
  title?: string | null;

  /** Tailwind grid columns override */
  gridClassName?: string;

  /** Compact mode — smaller thumbnails */
  compact?: boolean;
}

export default function RecordImages({
  parentTable,
  parentRowId,
  baseUrl,
  publicAnonKey,
  groupByField = false,
  emptyMessage = 'No images attached',
  title,
  gridClassName,
  compact = false,
}: RecordImagesProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);

  useEffect(() => {
    if (!parentTable || !parentRowId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url = `${baseUrl}/images/${encodeURIComponent(parentTable)}/${encodeURIComponent(parentRowId)}`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${publicAnonKey}` },
        });
        if (!resp.ok) {
          throw new Error(`Failed to load images (${resp.status})`);
        }
        const data = await resp.json();
        if (!cancelled) {
          setImages(Array.isArray(data.files) ? data.files : []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load images');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [parentTable, parentRowId, baseUrl, publicAnonKey]);

  const thumbClass = compact
    ? 'w-full h-20 object-cover rounded border border-gray-200'
    : 'w-full h-32 object-cover rounded-lg border border-gray-200';

  const gridClass =
    gridClassName ??
    (compact
      ? 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2'
      : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading images...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 py-2">
        {error}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <ImageIcon className="w-10 h-10 mb-2" />
        <span className="text-sm">{emptyMessage}</span>
      </div>
    );
  }

  const renderGrid = (list: ImageRecord[]) => (
    <div className={gridClass}>
      {list.map((rec, i) => (
        <a
          key={rec.id ?? i}
          href={rec.url}
          target="_blank"
          rel="noopener noreferrer"
          className="relative group block"
        >
          <img
            src={rec.url}
            alt={rec.caption ?? rec.fieldName ?? `Image ${i + 1}`}
            className={thumbClass}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          {rec.fieldName && !groupByField && (
            <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
              {rec.fieldName}
            </div>
          )}
        </a>
      ))}
    </div>
  );

  // Optional grouping by field_name
  if (groupByField) {
    const groups = new Map<string, ImageRecord[]>();
    for (const rec of images) {
      const key = rec.fieldName ?? 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rec);
    }
    return (
      <div className="space-y-4">
        {title !== null && (
          <h4 className="text-sm font-medium text-gray-700">
            {title ?? 'Images'} <span className="text-gray-400">({images.length})</span>
          </h4>
        )}
        {Array.from(groups.entries()).map(([field, list]) => (
          <div key={field} className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {field} <span className="text-gray-400">({list.length})</span>
            </div>
            {renderGrid(list)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {title !== null && (
        <h4 className="text-sm font-medium text-gray-700">
          {title ?? 'Images'} <span className="text-gray-400">({images.length})</span>
        </h4>
      )}
      {renderGrid(images)}
    </div>
  );
}
