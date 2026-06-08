import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import {
  FolderOpen, Upload, Search, Download, Trash2, Link2, FileText,
  AlertCircle, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth-context';
import {
  listDocuments, uploadDocument, deleteDocument,
  getDocumentUrl, getDocumentShareUrl,
  DOC_CATEGORIES, type DocumentRow,
} from '../lib/documentLibraryStorage';

const PRODUCT_LINES = ['XC', 'RAIL', 'DSX', 'LynX', 'XC Oriented', 'XC 2.75"', 'ReConnect', 'mRAIL', 'XFire'];

function formatSize(bytes: number | null): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentLibrary() {
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'sqm';

  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [productFilter, setProductFilter] = useState<string>('All');

  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', category: 'Manuals' as string, productLine: '',
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => { fetchDocs(); }, []);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const rows = await listDocuments();
      setDocs(rows);
      setTableMissing(false);
    } catch (err: any) {
      if (err?.code === 'PGRST205' || err?.message?.includes('could not find')) {
        setTableMissing(true);
      } else {
        toast.error('Failed to load documents');
      }
    }
    setLoading(false);
  };

  const filtered = docs.filter((d) => {
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      if (
        !d.title.toLowerCase().includes(q) &&
        !(d.description || '').toLowerCase().includes(q) &&
        !d.file_name.toLowerCase().includes(q)
      ) return false;
    }
    if (categoryFilter !== 'All' && d.category !== categoryFilter) return false;
    if (productFilter !== 'All' && (d.product_line || '') !== productFilter) return false;
    return true;
  });

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setSelectedFile(f);
    if (f && !form.title) setForm((s) => ({ ...s, title: f.name.replace(/\.[^.]+$/, '') }));
  };

  const handleUpload = async () => {
    if (!selectedFile) { toast.error('Choose a file first'); return; }
    if (!form.title.trim()) { toast.error('Enter a title'); return; }
    setUploading(true);
    try {
      await uploadDocument({
        file: selectedFile,
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        productLine: form.productLine || null,
        uploadedBy: user?.id || null,
        uploadedByName: user?.name || null,
      });
      toast.success('Document uploaded');
      setShowUpload(false);
      setSelectedFile(null);
      setForm({ title: '', description: '', category: 'Manuals', productLine: '' });
      if (fileRef.current) fileRef.current.value = '';
      fetchDocs();
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed');
    }
    setUploading(false);
  };

  const handleOpen = async (doc: DocumentRow) => {
    try {
      const url = await getDocumentUrl(doc);
      window.open(url, '_blank');
    } catch (err: any) {
      toast.error(err?.message || 'Could not open document');
    }
  };

  const handleShare = async (doc: DocumentRow) => {
    try {
      const url = await getDocumentShareUrl(doc);
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Customer link copied to clipboard');
      } catch {
        window.prompt('Copy this customer link:', url);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not create share link');
    }
  };

  const handleDelete = async (doc: DocumentRow) => {
    if (!confirm(`Delete "${doc.title}"? This removes the file for everyone.`)) return;
    try {
      await deleteDocument(doc);
      toast.success('Document deleted');
      fetchDocs();
    } catch (err: any) {
      toast.error(err?.message || 'Delete failed');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-800/50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Document Library</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-1">
              Manuals, diagrams, how-to's & best practices — easy reference and share with customers
            </p>
          </div>
          {canManage && (
            <Button size="lg" onClick={() => setShowUpload(true)}>
              <Upload className="w-5 h-5 mr-2" />
              Upload Document
            </Button>
          )}
        </div>

        {/* Table missing warning */}
        {tableMissing && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <AlertCircle className="w-6 h-6 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900 mb-2">Database Table Not Found</h3>
                  <p className="text-amber-800 text-sm mb-3">
                    The <code className="bg-amber-100 px-1.5 py-0.5 rounded">document_library</code> table
                    and storage bucket aren't set up yet. Run
                    <code className="bg-amber-100 px-1.5 py-0.5 rounded mx-1">database-migrations/document_library_storage.sql</code>
                    in the Supabase SQL editor.
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

        {/* Filters */}
        {!tableMissing && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  placeholder="Search documents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {['All', ...DOC_CATEGORIES].map((c) => (
                  <Badge
                    key={c}
                    className={`cursor-pointer ${categoryFilter === c
                      ? 'bg-blue-100 text-blue-800 border-2 border-blue-300'
                      : 'bg-gray-100 text-gray-600 border border-gray-300'}`}
                    onClick={() => setCategoryFilter(c)}
                  >
                    {c}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {['All', ...PRODUCT_LINES].map((p) => (
                  <Badge
                    key={p}
                    className={`cursor-pointer ${productFilter === p
                      ? 'bg-emerald-100 text-emerald-800 border-2 border-emerald-300'
                      : 'bg-gray-100 text-gray-600 border border-gray-300'}`}
                    onClick={() => setProductFilter(p)}
                  >
                    {p === 'All' ? 'All products' : p}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* List */}
        {loading ? (
          <Card><CardContent className="py-12 text-center text-gray-500">Loading documents...</CardContent></Card>
        ) : !tableMissing && filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FolderOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                {searchTerm || categoryFilter !== 'All' || productFilter !== 'All'
                  ? 'No documents match your filters'
                  : 'No documents yet'}
              </p>
              {canManage && (
                <Button className="mt-4" onClick={() => setShowUpload(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Your First Document
                </Button>
              )}
            </CardContent>
          </Card>
        ) : !tableMissing && (
          <div className="space-y-3">
            {filtered.map((doc) => (
              <Card key={doc.id} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {doc.title}
                          </h3>
                          <Badge className="bg-blue-100 text-blue-800 border-blue-200">{doc.category}</Badge>
                          {doc.product_line && (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                              {doc.product_line}
                            </Badge>
                          )}
                        </div>
                        {doc.description && (
                          <p className="text-gray-600 dark:text-gray-300 text-sm mb-1 line-clamp-2">{doc.description}</p>
                        )}
                        <div className="flex gap-3 text-xs text-gray-500 flex-wrap">
                          <span className="truncate max-w-[260px]">{doc.file_name}</span>
                          {doc.file_size != null && <span>{formatSize(doc.file_size)}</span>}
                          <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                          {doc.uploaded_by_name && <span>by {doc.uploaded_by_name}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button variant="outline" size="sm" title="Open / download" onClick={() => handleOpen(doc)}>
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" title="Copy customer link" onClick={() => handleShare(doc)}>
                        <Link2 className="w-4 h-4" />
                      </Button>
                      {canManage && (
                        <Button variant="outline" size="sm" title="Delete" onClick={() => handleDelete(doc)}>
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => !uploading && setShowUpload(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Upload Document</h2>
              <button onClick={() => !uploading && setShowUpload(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">File</label>
                <input
                  ref={fileRef}
                  type="file"
                  onChange={handleFilePick}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {selectedFile && <p className="text-xs text-gray-500 mt-1">{selectedFile.name} · {formatSize(selectedFile.size)}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
                <Input value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} placeholder="e.g. XFire Panel Operator Manual" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description (optional)</label>
                <Input value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} placeholder="Short description" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                  >
                    {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Product line (optional)</label>
                  <select
                    value={form.productLine}
                    onChange={(e) => setForm((s) => ({ ...s, productLine: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                  >
                    <option value="">— None —</option>
                    {PRODUCT_LINES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setShowUpload(false)} disabled={uploading}>Cancel</Button>
              <Button onClick={handleUpload} disabled={uploading}>
                {uploading ? 'Uploading...' : 'Upload'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
