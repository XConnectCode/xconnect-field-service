import { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Polymorphic image uploader.
 *
 * Preferred usage (new):
 *   <ImageUpload parentTable="incidents" parentRowId={row.row_id} ... />
 *   <ImageUpload parentTable="panels" parentRowId={panel.row_id} ... />
 *
 * Legacy usage (still supported — incidents only):
 *   <ImageUpload incidentId={id} ... />
 *
 * Talks to the polymorphic Edge Function routes:
 *   POST   /images/:parentTable/:parentRowId
 *   GET    /images/:parentTable/:parentRowId
 *   DELETE /images/:imageId
 */

export interface ImageRecord {
  id: string;
  url: string;
  storagePath?: string;
  fieldName?: string | null;
  caption?: string | null;
  source?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  createdAt?: string;
}

interface ImageUploadProps {
  /** New polymorphic API — table name in ALLOWED_PARENTS */
  parentTable?: string;
  /** New polymorphic API — primary key value (row_id / uuid) of parent record */
  parentRowId?: string;

  /** Legacy API — incidents only. If set and parentTable not provided, assumes incidents. */
  incidentId?: string;

  /** Optional fieldName to tag uploads (e.g. "Image1", "Pictures") */
  fieldName?: string;

  onImageUploaded?: (rec: ImageRecord) => void;
  onImageDeleted?: (rec: ImageRecord) => void;

  /** Pre-loaded list to display (objects with id+url). If omitted and `autoLoad` is true, will GET from backend. */
  existingImages?: ImageRecord[];

  /** If true, component fetches its own image list on mount via GET /images/:parentTable/:parentRowId */
  autoLoad?: boolean;

  maxImages?: number;
  baseUrl: string;
  publicAnonKey: string;

  /** Hide the uploader UI (display-only mode) */
  readOnly?: boolean;
}

export default function ImageUpload({
  parentTable,
  parentRowId,
  incidentId,
  fieldName,
  onImageUploaded,
  onImageDeleted,
  existingImages,
  autoLoad = false,
  maxImages = 10,
  baseUrl,
  publicAnonKey,
  readOnly = false,
}: ImageUploadProps) {
  // Resolve effective parent
  const effectiveTable = parentTable ?? (incidentId ? 'incidents' : '');
  const effectiveRowId = parentRowId ?? incidentId ?? '';

  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<ImageRecord[]>(existingImages ?? []);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-load existing images for this record
  useEffect(() => {
    if (!autoLoad || !effectiveTable || !effectiveRowId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await fetch(
          `${baseUrl}/images/${encodeURIComponent(effectiveTable)}/${encodeURIComponent(effectiveRowId)}`,
          { headers: { Authorization: `Bearer ${publicAnonKey}` } }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (!cancelled && Array.isArray(data.files)) {
            // Normalize: backend returns ImageRecord-shaped objects
            setImages(data.files);
          }
        }
      } catch (err) {
        console.error('Failed to load images:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoLoad, effectiveTable, effectiveRowId, baseUrl, publicAnonKey]);

  // Keep state in sync if parent passes new existingImages
  useEffect(() => {
    if (existingImages) setImages(existingImages);
  }, [existingImages]);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!effectiveTable || !effectiveRowId) {
      toast.error('Missing parent record reference');
      return;
    }

    if (images.length + files.length > maxImages) {
      toast.error(`Maximum ${maxImages} images allowed`);
      return;
    }

    setUploading(true);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} is not an image file`);
          continue;
        }

        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} is too large (max 10MB)`);
          continue;
        }

        const formData = new FormData();
        formData.append('file', file);
        if (fieldName) formData.append('fieldName', fieldName);

        const url = `${baseUrl}/images/${encodeURIComponent(effectiveTable)}/${encodeURIComponent(effectiveRowId)}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${publicAnonKey}` },
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          // Backend returns { id, url, storagePath, ... }
          const rec: ImageRecord = {
            id: data.id,
            url: data.url,
            storagePath: data.storagePath,
            fieldName: data.fieldName ?? fieldName ?? null,
          };
          setImages((prev) => [...prev, rec]);
          onImageUploaded?.(rec);
          toast.success(`${file.name} uploaded`);
        } else {
          const error = await response.json().catch(() => ({}));
          toast.error(`Failed to upload ${file.name}: ${error.error || response.statusText}`);
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload images');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleRemoveImage = async (rec: ImageRecord) => {
    if (!rec.id) {
      toast.error('Image is missing id — cannot delete');
      return;
    }
    if (!confirm('Are you sure you want to delete this image?')) return;

    try {
      const response = await fetch(
        `${baseUrl}/images/${encodeURIComponent(rec.id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${publicAnonKey}` },
        }
      );

      if (response.ok) {
        setImages((prev) => prev.filter((img) => img.id !== rec.id));
        onImageDeleted?.(rec);
        toast.success('Image deleted');
      } else {
        toast.error('Failed to delete image');
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Failed to delete image');
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      {!readOnly && (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDrop={handleDrop}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
            disabled={uploading || images.length >= maxImages}
          />

          <div className="flex flex-col items-center gap-2">
            {uploading ? (
              <>
                <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                <p className="text-sm text-gray-600">Uploading...</p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-400" />
                <div>
                  <p className="text-sm text-gray-600">
                    Drag and drop images here, or{' '}
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={images.length >= maxImages}
                    >
                      browse
                    </button>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Max {maxImages} images, up to 10MB each (JPG, PNG, GIF, WebP)
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Image Grid */}
      {loading && (
        <div className="flex items-center justify-center py-4 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading images...</span>
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {images.map((rec, index) => (
            <div key={rec.id ?? index} className="relative group">
              <a href={rec.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={rec.url}
                  alt={rec.caption ?? rec.fieldName ?? `Image ${index + 1}`}
                  className="w-full h-32 object-cover rounded-lg border border-gray-200"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </a>
              {rec.fieldName && (
                <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                  {rec.fieldName}
                </div>
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemoveImage(rec)}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && !uploading && !loading && (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <ImageIcon className="w-12 h-12" />
        </div>
      )}
    </div>
  );
}
