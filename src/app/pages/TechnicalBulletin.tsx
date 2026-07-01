import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { FileText, Download, Plus, X, Upload, Image as ImageIcon, Save, ArrowLeft, ChevronUp, ChevronDown, Trash2, List as ListIcon, AlignLeft, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { generateTechnicalBulletinPDF } from '../lib/generateTechnicalBulletinPDF';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth-context';
import {
  uploadBulletinReport,
  getBulletinReportUrl,
  listBulletinReports,
  type BulletinReportRow,
} from '../lib/bulletinReportStorage';

const SEVERITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low', 'Information'] as const;

// Bulletin types — each serves a different purpose and seeds a sensible default severity.
const BULLETIN_TYPE_OPTIONS = [
  {
    value: 'Alert',
    label: 'Alert',
    description: 'Urgent safety or quality warning requiring immediate attention.',
    defaultSeverity: 'Critical' as const,
  },
  {
    value: 'Customer Action Required',
    label: 'Customer Action Required',
    description: 'The customer must take action (inspect, return, update, etc.).',
    defaultSeverity: 'High' as const,
  },
  {
    value: 'Internal Action',
    label: 'Internal Action',
    description: 'Only XConnect teams (SQMs / field) need to act.',
    defaultSeverity: 'Medium' as const,
  },
  {
    value: 'Informational',
    label: 'Informational / Notice',
    description: 'General notice or FYI — no action required.',
    defaultSeverity: 'Information' as const,
  },
] as const;

// ── Flexible body sections ────────────────────────────────────────────────────
type SectionFormat = 'paragraph' | 'bullets';
interface BulletinSection {
  id: string;
  heading: string;
  format: SectionFormat;
  // paragraph -> body holds the text; bullets -> bullets holds the list
  body: string;
  bullets: string[];
}

const newSectionId = () =>
  `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const makeSection = (
  heading: string,
  format: SectionFormat = 'paragraph',
): BulletinSection => ({
  id: newSectionId(),
  heading,
  format,
  body: '',
  bullets: format === 'bullets' ? [''] : [],
});

// Per-type seeded section templates (all fully editable afterward).
const TYPE_SECTION_TEMPLATES: Record<string, Array<{ heading: string; format: SectionFormat }>> = {
  'Alert': [
    { heading: 'Subject', format: 'paragraph' },
    { heading: 'Issue Description', format: 'paragraph' },
    { heading: 'Immediate Action Required', format: 'bullets' },
    { heading: 'Affected Scope', format: 'paragraph' },
    { heading: 'Additional Information', format: 'paragraph' },
  ],
  'Customer Action Required': [
    { heading: 'Subject', format: 'paragraph' },
    { heading: 'Background', format: 'paragraph' },
    { heading: 'Issue Description', format: 'paragraph' },
    { heading: 'Required Customer Action', format: 'bullets' },
    { heading: 'Implementation Schedule / Deadline', format: 'paragraph' },
    { heading: 'Additional Information', format: 'paragraph' },
  ],
  'Internal Action': [
    { heading: 'Subject', format: 'paragraph' },
    { heading: 'Background', format: 'paragraph' },
    { heading: 'Issue Description', format: 'paragraph' },
    { heading: 'Corrective Action', format: 'paragraph' },
    { heading: 'Implementation Schedule', format: 'paragraph' },
    { heading: 'Loading / Handling Guidance', format: 'bullets' },
    { heading: 'Additional Information', format: 'paragraph' },
  ],
  'Informational': [
    { heading: 'Subject', format: 'paragraph' },
    { heading: 'Background', format: 'paragraph' },
    { heading: 'Details', format: 'paragraph' },
    { heading: 'Additional Information', format: 'paragraph' },
  ],
};

const seedSectionsForType = (type: string): BulletinSection[] => {
  const tmpl = TYPE_SECTION_TEMPLATES[type] || TYPE_SECTION_TEMPLATES['Informational'];
  return tmpl.map(t => makeSection(t.heading, t.format));
};

// Build sections from legacy columns (for bulletins created before Phase 2).
const sectionsFromLegacy = (data: any): BulletinSection[] => {
  const out: BulletinSection[] = [];
  if (data.summary?.trim()) {
    const s = makeSection('Summary', 'paragraph'); s.body = data.summary; out.push(s);
  }
  if (data.background?.trim()) {
    const s = makeSection('Background', 'paragraph'); s.body = data.background; out.push(s);
  }
  if (data.technical_details?.trim()) {
    const s = makeSection('Technical Details', 'paragraph'); s.body = data.technical_details; out.push(s);
  }
  const acts = (data.recommended_actions || []).filter((a: string) => a && a.trim());
  if (acts.length) {
    const s = makeSection('Recommended Actions', 'bullets'); s.bullets = acts; out.push(s);
  }
  return out.length ? out : [makeSection('Subject', 'paragraph')];
};

// Normalize loaded sections JSON into well-formed BulletinSection objects.
const normalizeSections = (raw: any): BulletinSection[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(s => s && typeof s === 'object')
    .map((s: any) => ({
      id: s.id || newSectionId(),
      heading: typeof s.heading === 'string' ? s.heading : '',
      format: s.format === 'bullets' ? 'bullets' : 'paragraph',
      body: typeof s.body === 'string' ? s.body : '',
      bullets: Array.isArray(s.bullets) ? s.bullets.filter((b: any) => typeof b === 'string') : [],
    }));
};

// Derive legacy summary/technical_details from sections so NOT NULL columns stay
// valid and old views keep rendering. summary = first non-empty section body;
// technical_details = all section content concatenated.
const deriveLegacyFromSections = (sections: BulletinSection[]) => {
  const sectionText = (s: BulletinSection) =>
    s.format === 'bullets'
      ? s.bullets.filter(b => b.trim()).map(b => `\u2022 ${b.trim()}`).join('\n')
      : s.body.trim();
  const filled = sections.filter(s => sectionText(s));
  const summary = filled.length ? sectionText(filled[0]).split('\n')[0].slice(0, 500) : '(see bulletin)';
  const technical = filled.map(s => `${s.heading}\n${sectionText(s)}`).join('\n\n') || '(see bulletin)';
  return { summary, technical };
};

// Pull the first run of digits out of a (possibly messy) bulletin number string.
// e.g. "2026-003" -> 2026, "004-2026" -> 4, "TB-001-01132024" -> 1
// We treat 1-3 digit runs as sequence numbers; anything 4+ digits (years) is ignored
// so the clean sequential counter (001, 004, ...) keeps incrementing.
const extractSequence = (raw: string): number => {
  if (!raw) return 0;
  const runs = raw.match(/\d+/g) || [];
  let best = 0;
  for (const r of runs) {
    if (r.length <= 3) {
      const n = parseInt(r, 10);
      if (!isNaN(n) && n > best) best = n;
    }
  }
  return best;
};

// Compute the next sequential bulletin number from all existing rows.
// Returns a zero-padded 3-digit string, e.g. "005".
const computeNextBulletinNumber = (existing: string[]): string => {
  let max = 0;
  for (const b of existing) {
    const seq = extractSequence(b);
    if (seq > max) max = seq;
  }
  return String(max + 1).padStart(3, '0');
};
const PRODUCT_OPTIONS = [
  'mRAIL', 'XC 2.75"', 'XC', 'DSX', 'RAIL', 'LynX',
  'ReConnect', 'Haptix', 'XC Oriented', 'XFire', 'All Products'
];
const ROLE_OPTIONS = ['Service Quality Rep', 'District Rep', 'Sales Rep', 'Executive Management'] as const;
const PART_OPTIONS = [
  'Detonator', 'Charge', 'Gun Body', 'Tandem Sub', 'Bulkhead', 
  'Initiator', 'Seal/O-Ring', 'Circuit Board', 'Booster', 
  'Connector', 'Housing', 'Wire/Cable', 'Switch', 'Battery',
  'Sensor', 'Other'
];

const LS_BULLETIN_FILES = 'xc_bulletin_files';
const getBulletinFileStore = (): Record<string, { url: string; label: string }> => {
  try { return JSON.parse(localStorage.getItem(LS_BULLETIN_FILES) || '{}'); } catch { return {}; }
};

export default function TechnicalBulletin() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [bulletinNumber, setBulletinNumber] = useState('');
  const [nextNumberPreview, setNextNumberPreview] = useState('');
  const [bulletinType, setBulletinType] = useState<string>('Informational');
  const [sections, setSections] = useState<BulletinSection[]>(() => seedSectionsForType('Informational'));
  const [sectionsTouched, setSectionsTouched] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [severity, setSeverity] = useState<'Critical' | 'High' | 'Medium' | 'Low' | 'Information'>('Information');
  const [affectedProducts, setAffectedProducts] = useState<string[]>([]);
  const [affectedParts, setAffectedParts] = useState<string[]>([]);
  const [availableParts, setAvailableParts] = useState<string[]>([]);
  const [loadingParts, setLoadingParts] = useState(true);
  const [distributionList, setDistributionList] = useState('');
  const [roleTypes, setRoleTypes] = useState<string[]>([]);
  const [customerFileUrl,   setCustomerFileUrl]   = useState('');
  const [customerFileLabel, setCustomerFileLabel] = useState('');
  const [images, setImages] = useState<Array<{ url: string; caption: string }>>([]);
  const [problemImages, setProblemImages] = useState<Array<{ url: string; caption: string }>>([]);
  const [fixImages, setFixImages] = useState<Array<{ url: string; caption: string }>>([]);
  const [generating, setGenerating] = useState(false);
  const [generatingVariant, setGeneratingVariant] = useState<'standard' | 'compact' | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [storedReports, setStoredReports] = useState<BulletinReportRow[]>([]);
  const isEditMode = id && id !== 'new';

  // Load any previously-generated/stored PDFs for this saved bulletin.
  const loadStoredReports = async (bulletinId: string) => {
    if (!bulletinId) return;
    const rows = await listBulletinReports(bulletinId);
    setStoredReports(rows);
  };

  // Load existing bulletin if editing
  useEffect(() => {
    if (isEditMode) {
      loadBulletin();
    }
  }, [id]);

  const loadBulletin = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('technical_bulletins')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error loading bulletin:', error);
      toast.error('Failed to load bulletin');
      navigate('/technical-bulletins');
    } else if (data) {
      setBulletinNumber(data.bulletin_number);
      setBulletinType(data.bulletin_type || 'Informational');
      // Sections: use stored sections JSON if present, else build from legacy columns.
      const loadedSections = normalizeSections(data.sections);
      setSections(loadedSections.length ? loadedSections : sectionsFromLegacy(data));
      setSectionsTouched(true); // editing an existing bulletin: never auto-reseed
      setTitle(data.title);
      setDate(data.date);
      setSeverity(data.severity);
      setAffectedProducts(data.affected_products || []);
      setAffectedParts(data.affected_parts || []);
      setDistributionList(data.distribution_list?.join(', ') || '');
      setRoleTypes(data.role_types || []);
      setProblemImages(data.problem_images || []);
      setFixImages(data.fix_images || []);
      // customer file link now persists in DB; fall back to localStorage for pre-existing entries
      const fileEntry = getBulletinFileStore()[data.id] || {};
      setCustomerFileUrl(data.customer_file_url || fileEntry.url || '');
      setCustomerFileLabel(data.customer_file_label || fileEntry.label || '');
      // Pull any previously-generated PDFs so the user can grab them directly.
      loadStoredReports(data.id);
    }
    setLoading(false);
  };

  // When user picks a bulletin type, seed a sensible default severity
  // (only if they haven't already changed severity away from the default).
  const handleTypeChange = (newType: string) => {
    setBulletinType(newType);
    const opt = BULLETIN_TYPE_OPTIONS.find(t => t.value === newType);
    if (opt) setSeverity(opt.defaultSeverity);
    // Reseed sections from the type template only if the user hasn't edited them yet.
    if (!sectionsTouched && !isEditMode) {
      setSections(seedSectionsForType(newType));
    }
  };

  // ── Section editor handlers ─────────────────────────────────────────────────
  const markTouched = () => { if (!sectionsTouched) setSectionsTouched(true); };

  const updateSection = (id: string, patch: Partial<BulletinSection>) => {
    markTouched();
    setSections(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
  };
  const setSectionFormat = (id: string, format: SectionFormat) => {
    markTouched();
    setSections(prev => prev.map(s => {
      if (s.id !== id) return s;
      if (format === s.format) return s;
      // Convert content when toggling format.
      if (format === 'bullets') {
        const lines = s.body.split('\n').map(l => l.replace(/^[\u2022\-*]\s*/, '').trim()).filter(Boolean);
        return { ...s, format, bullets: lines.length ? lines : [''], body: '' };
      } else {
        return { ...s, format, body: s.bullets.filter(b => b.trim()).join('\n'), bullets: [] };
      }
    }));
  };
  const addSection = () => {
    markTouched();
    setSections(prev => [...prev, makeSection('New Section', 'paragraph')]);
  };
  const removeSection = (id: string) => {
    markTouched();
    setSections(prev => prev.filter(s => s.id !== id));
  };
  const moveSection = (id: string, dir: -1 | 1) => {
    markTouched();
    setSections(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  };
  const addBullet = (id: string) => {
    markTouched();
    setSections(prev => prev.map(s => (s.id === id ? { ...s, bullets: [...s.bullets, ''] } : s)));
  };
  const updateBullet = (id: string, bi: number, value: string) => {
    markTouched();
    setSections(prev => prev.map(s => {
      if (s.id !== id) return s;
      const bullets = [...s.bullets];
      bullets[bi] = value;
      return { ...s, bullets };
    }));
  };
  const removeBullet = (id: string, bi: number) => {
    markTouched();
    setSections(prev => prev.map(s => (s.id === id ? { ...s, bullets: s.bullets.filter((_, i) => i !== bi) } : s)));
  };

  const toggleProduct = (product: string) => {
    setAffectedProducts(prev =>
      prev.includes(product)
        ? prev.filter(p => p !== product)
        : [...prev, product]
    );
  };

  const togglePart = (part: string) => {
    setAffectedParts(prev =>
      prev.includes(part)
        ? prev.filter(p => p !== part)
        : [...prev, part]
    );
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image file`);
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 10MB)`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImages(prev => [...prev, { url: event.target!.result as string, caption: '' }]);
          toast.success(`${file.name} added successfully`);
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    e.target.value = '';
  };

  const updateImageCaption = (index: number, caption: string) => {
    setImages(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], caption };
      return updated;
    });
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleProblemImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image file`);
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 10MB)`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setProblemImages(prev => [...prev, { url: event.target!.result as string, caption: '' }]);
          toast.success(`${file.name} added successfully`);
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const updateProblemImageCaption = (index: number, caption: string) => {
    setProblemImages(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], caption };
      return updated;
    });
  };

  const removeProblemImage = (index: number) => {
    setProblemImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleFixImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image file`);
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 10MB)`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setFixImages(prev => [...prev, { url: event.target!.result as string, caption: '' }]);
          toast.success(`${file.name} added successfully`);
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const updateFixImageCaption = (index: number, caption: string) => {
    setFixImages(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], caption };
      return updated;
    });
  };

  const removeFixImage = (index: number) => {
    setFixImages(prev => prev.filter((_, i) => i !== index));
  };

  // Sections cleaned for persistence / PDF (drop fully-empty sections).
  const cleanedSections = (): BulletinSection[] =>
    sections
      .map(s => ({
        ...s,
        heading: s.heading.trim(),
        body: s.body.trim(),
        bullets: s.bullets.map(b => b.trim()).filter(Boolean),
      }))
      .filter(s => s.heading || s.body || s.bullets.length);

  const handleGeneratePDF = async (compact = false) => {
    const cleaned = cleanedSections();
    if (!title.trim() || cleaned.length === 0) {
      toast.error('Please add a title and at least one section with content.');
      return;
    }
    if (!isEditMode && !bulletinNumber.trim()) {
      toast.error('Save the bulletin first so it gets a bulletin number, then export the PDF.');
      return;
    }

    setGenerating(true);
    setGeneratingVariant(compact ? 'compact' : 'standard');
    try {
      // Build the PDF as a Blob so we can both download it locally AND persist
      // it to shared storage (so the saved bulletin keeps its generated doc).
      const blob = await generateTechnicalBulletinPDF({
        bulletinNumber: bulletinNumber.trim(),
        title: title.trim(),
        date,
        severity,
        affectedProducts: affectedProducts.length > 0 ? affectedProducts : ['All Products'],
        failedParts: affectedParts.length > 0 ? affectedParts : undefined,
        distributionList: distributionList.trim() ? distributionList.split(',').map(s => s.trim()) : undefined,
        sections: cleaned,
        roleType: roleTypes.length > 0 ? roleTypes : undefined,
        customerFileUrl:   customerFileUrl.trim()   || undefined,
        customerFileLabel: customerFileLabel.trim() || undefined,
        problemImages: problemImages.length > 0 ? problemImages : undefined,
        fixImages: fixImages.length > 0 ? fixImages : undefined,
        compact,
        returnBlob: true,
      }) as Blob;

      const fileName = `Technical_Bulletin_TB-${bulletinNumber.trim()}_${compact ? 'Compact' : 'Standard'}.pdf`;

      // 1) Trigger the local download (same UX as before).
      const localUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = localUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(localUrl), 4000);
      toast.success(`${compact ? 'Compact' : 'Standard'} PDF generated successfully!`);

      // 2) Persist to shared storage so it's grabbable from the saved entry.
      //    Only possible once the bulletin row exists (edit mode / has id).
      const savedId = isEditMode ? (id as string) : '';
      if (savedId) {
        try {
          const inserted = await uploadBulletinReport({
            blob,
            bulletinId: savedId,
            bulletinNumber: bulletinNumber.trim(),
            variant: compact ? 'compact' : 'standard',
            generatedBy: user?.email || (user as any)?.name || null,
          });
          setStoredReports(prev => {
            const filtered = prev.filter(r => r.report_type !== inserted.report_type);
            return [inserted, ...filtered];
          });
          toast.success(`${compact ? 'Compact' : 'Standard'} PDF saved to this bulletin.`);
        } catch (storeErr: any) {
          console.warn('Could not store bulletin PDF:', storeErr?.message);
          toast.info(`PDF downloaded, but could not be saved to the bulletin: ${storeErr?.message || 'storage unavailable'}`);
        }
      }
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setGenerating(false);
      setGeneratingVariant(null);
    }
  };

  // Preview/download a previously-stored PDF straight from the saved bulletin.
  const openStoredReport = async (report: BulletinReportRow, download: boolean) => {
    try {
      const url = await getBulletinReportUrl(report);
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      if (download) a.download = report.file_name || 'bulletin.pdf';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Could not open the stored document');
    }
  };

  const handleSave = async () => {
    // Validation (bulletin number is auto-assigned — no manual entry required)
    if (!title.trim()) {
      toast.error('Please enter a title');
      return;
    }
    const cleaned = cleanedSections();
    if (cleaned.length === 0) {
      toast.error('Please add at least one section with content.');
      return;
    }

    setSaving(true);

    // For new bulletins, assign the authoritative sequential number at save time
    // (re-query the latest max so concurrent creates don't collide).
    let assignedNumber = bulletinNumber.trim();
    if (!isEditMode) {
      const { data: existingRows } = await supabase
        .from('technical_bulletins')
        .select('bulletin_number');
      const existing = (existingRows || []).map((r: any) => r.bulletin_number).filter(Boolean);
      assignedNumber = computeNextBulletinNumber(existing);
    }

    // Canonical body = sections. Derive legacy columns so NOT NULL constraints
    // hold and any older views/exports keep working.
    const { summary: legacySummary, technical: legacyTechnical } = deriveLegacyFromSections(cleaned);
    const legacyActions = cleaned
      .filter(s => s.format === 'bullets')
      .flatMap(s => s.bullets);

    const bulletinData = {
      bulletin_number: assignedNumber,
      bulletin_type: bulletinType,
      sections: cleaned,
      title: title.trim(),
      date,
      severity,
      affected_products: affectedProducts,
      affected_parts: affectedParts,
      distribution_list: distributionList.trim() ? distributionList.split(',').map(s => s.trim()) : [],
      summary: legacySummary,
      background: null,
      technical_details: legacyTechnical,
      recommended_actions: legacyActions,
      role_types: roleTypes,
      problem_images: problemImages,
      fix_images: fixImages,
      customer_file_url: customerFileUrl.trim() || null,
      customer_file_label: customerFileLabel.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let error, data;
    if (isEditMode) {
      // Update existing bulletin
      ({ error, data } = await supabase
        .from('technical_bulletins')
        .update(bulletinData)
        .eq('id', id)
        .select()
        .single());
    } else {
      // Create new bulletin
      ({ error, data } = await supabase
        .from('technical_bulletins')
        .insert({
          ...bulletinData,
          created_at: new Date().toISOString(),
        })
        .select()
        .single());
    }

    setSaving(false);

    if (error) {
      console.error('Error saving bulletin:', error);
      if ((error as any).code === '42501') {
        toast.error(
          'Row-Level Security is blocking saves. Run this in Supabase SQL Editor: ALTER TABLE technical_bulletins DISABLE ROW LEVEL SECURITY;',
          { duration: 12000 }
        );
      } else {
        toast.error(`Failed to save bulletin: ${error.message || 'Unknown error'}`);
      }
    } else {
      // Persist customer file link to localStorage (no DB column needed)
      const savedId = data?.id || id;
      if (savedId) {
        const store = getBulletinFileStore();
        store[savedId] = { url: customerFileUrl.trim(), label: customerFileLabel.trim() };
        localStorage.setItem(LS_BULLETIN_FILES, JSON.stringify(store));
      }
      toast.success(isEditMode ? 'Bulletin updated successfully!' : 'Bulletin created successfully!');
      if (!isEditMode && data) {
        // Edit mode is the same route with the row id (no `/edit` suffix).
        navigate(`/technical-bulletin/${data.id}`);
      }
    }
  };

  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'Critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'High': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'Medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Low': return 'bg-green-100 text-green-800 border-green-200';
      case 'Information': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  useEffect(() => {
    const fetchParts = async () => {
      const { data, error } = await supabase
        .from('lists')
        .select('failed_component')
        .not('failed_component', 'is', null)
        .order('failed_component', { ascending: true });

      if (error) {
        console.error('Error fetching parts:', error);
        toast.error('Failed to load parts from database');
        setLoadingParts(false);
        return;
      }

      if (data) {
        // Extract unique component names and filter out null/empty values
        const components = data
          .map(part => part.failed_component)
          .filter(component => component && component.trim())
          .filter((component, index, self) => self.indexOf(component) === index); // Remove duplicates
        
        setAvailableParts(components);
        setLoadingParts(false);
      }
    };

    fetchParts();
  }, []);

  // On new-form load, preview the next sequential bulletin number (display only;
  // the authoritative number is assigned at save time to avoid collisions).
  useEffect(() => {
    if (isEditMode) return;
    const fetchNextNumber = async () => {
      const { data, error } = await supabase
        .from('technical_bulletins')
        .select('bulletin_number');
      if (error || !data) return;
      const existing = data.map((r: any) => r.bulletin_number).filter(Boolean);
      setNextNumberPreview(computeNextBulletinNumber(existing));
    };
    fetchNextNumber();
  }, [isEditMode]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-800/50">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/technical-bulletins')}
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to List
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {loading ? 'Loading...' : isEditMode ? 'Edit Technical Bulletin' : 'Create Technical Bulletin'}
              </h1>
              <p className="text-gray-600 dark:text-gray-300 mt-1">
                {isEditMode ? 'Update and manage your technical bulletin' : 'Create professional technical bulletins for customer distribution'}
              </p>
            </div>
          </div>
          <FileText className="w-12 h-12 text-blue-600" />
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              Loading bulletin data...
            </CardContent>
          </Card>
        ) : (
          <>
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle>Bulletin Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="bulletinNumber">Bulletin Number</Label>
                <div
                  id="bulletinNumber"
                  className="mt-1 flex h-10 w-full items-center rounded-md border border-dashed border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700/50 px-3 font-mono text-sm text-gray-700 dark:text-gray-200"
                >
                  {isEditMode
                    ? `TB-${bulletinNumber}`
                    : `TB-${nextNumberPreview || '…'}`}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {isEditMode
                    ? 'Auto-assigned — locked'
                    : 'Auto-assigned on save (next available number)'}
                </p>
              </div>
              <div>
                <Label htmlFor="date">Date *</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            {/* Bulletin Type */}
            <div>
              <Label>Bulletin Type *</Label>
              <p className="text-xs text-gray-500 mb-2">Determines the purpose and a default severity (you can still change severity below).</p>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {BULLETIN_TYPE_OPTIONS.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => handleTypeChange(t.value)}
                    className={`text-left rounded-lg border p-3 transition ${
                      bulletinType === t.value
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-600'
                        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{t.label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="title">Title/Subject *</Label>
              <Input
                id="title"
                placeholder="e.g., Critical Safety Update for XFire Panels"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Severity */}
            <div>
              <Label>Severity Level *</Label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {SEVERITY_OPTIONS.map(sev => (
                  <Badge
                    key={sev}
                    className={`cursor-pointer ${
                      severity === sev
                        ? getSeverityColor(sev) + ' border-2'
                        : 'bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                    }`}
                    onClick={() => setSeverity(sev)}
                  >
                    {sev}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Affected Products */}
            <div>
              <Label>Affected Products</Label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {PRODUCT_OPTIONS.map(product => (
                  <Badge
                    key={product}
                    className={`cursor-pointer ${
                      affectedProducts.includes(product)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                    }`}
                    onClick={() => toggleProduct(product)}
                  >
                    {product}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {affectedProducts.length === 0 ? 'No products selected (will default to "All Products")' : `${affectedProducts.length} selected`}
              </p>
            </div>

            {/* Affected Parts */}
            <div>
              <Label htmlFor="affectedParts">Affected Parts</Label>
              {loadingParts ? (
                <p className="text-sm text-gray-500 mt-2">Loading parts...</p>
              ) : (
                <>
                  <select
                    id="affectedParts"
                    className="w-full mt-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onChange={(e) => {
                      const selectedPart = e.target.value;
                      if (selectedPart && !affectedParts.includes(selectedPart)) {
                        setAffectedParts([...affectedParts, selectedPart]);
                      }
                      e.target.value = '';
                    }}
                  >
                    <option value="">Select an affected part...</option>
                    {availableParts.map(part => (
                      <option key={part} value={part}>{part}</option>
                    ))}
                  </select>
                  {affectedParts.length > 0 && (
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {affectedParts.map(part => (
                        <Badge
                          key={part}
                          className="bg-blue-600 text-white cursor-pointer hover:bg-blue-700"
                          onClick={() => togglePart(part)}
                        >
                          {part}
                          <X className="w-3 h-3 ml-1 inline" />
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              )}
              <p className="text-xs text-gray-500 mt-1">
                {affectedParts.length === 0 ? 'No parts selected' : `${affectedParts.length} selected`}
              </p>
            </div>

            {/* Distribution List */}
            <div>
              <Label htmlFor="distributionList">Distribution List (optional)</Label>
              <Input
                id="distributionList"
                placeholder="e.g., West Texas District, Permian Basin, All Customers"
                value={distributionList}
                onChange={(e) => setDistributionList(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">Comma-separated list of recipients/districts</p>
            </div>

            {/* Customer File Download Link */}
            <div>
              <Label>Customer Download Link (optional)</Label>
              <div className="grid grid-cols-3 gap-3 mt-1">
                <div className="col-span-1">
                  <Input
                    id="customerFileLabel"
                    placeholder="e.g., Download Firmware v189"
                    value={customerFileLabel}
                    onChange={(e) => setCustomerFileLabel(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">Link label shown on PDF</p>
                </div>
                <div className="col-span-2">
                  <Input
                    id="customerFileUrl"
                    type="url"
                    placeholder="https://example.com/file.pdf"
                    value={customerFileUrl}
                    onChange={(e) => setCustomerFileUrl(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-1">URL (printed below the label)</p>
                </div>
              </div>
            </div>

            {/* Body Sections (flexible) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <Label className="text-base font-semibold">Bulletin Sections *</Label>
                  <p className="text-xs text-gray-500">Rename, reorder, add or remove sections. Each can be a paragraph or a bullet list.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addSection}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Section
                </Button>
              </div>

              <div className="space-y-4">
                {sections.map((section, sIdx) => (
                  <div key={section.id} className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-800">
                    {/* Section header row: reorder + heading + format toggle + remove */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex flex-col">
                        <button
                          type="button"
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          onClick={() => moveSection(section.id, -1)}
                          disabled={sIdx === 0}
                          title="Move up"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          onClick={() => moveSection(section.id, 1)}
                          disabled={sIdx === sections.length - 1}
                          title="Move down"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                      <Input
                        className="flex-1 font-medium"
                        placeholder="Section heading (e.g., Issue Description)"
                        value={section.heading}
                        onChange={(e) => updateSection(section.id, { heading: e.target.value })}
                      />
                      <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
                        <button
                          type="button"
                          className={`px-2 py-1.5 text-xs flex items-center gap-1 ${section.format === 'paragraph' ? 'bg-blue-600 text-white' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                          onClick={() => setSectionFormat(section.id, 'paragraph')}
                          title="Paragraph"
                        >
                          <AlignLeft className="w-3.5 h-3.5" /> Text
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-1.5 text-xs flex items-center gap-1 ${section.format === 'bullets' ? 'bg-blue-600 text-white' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}
                          onClick={() => setSectionFormat(section.id, 'bullets')}
                          title="Bullet list"
                        >
                          <ListIcon className="w-3.5 h-3.5" /> Bullets
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeSection(section.id)}
                        title="Remove section"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>

                    {/* Section body */}
                    {section.format === 'paragraph' ? (
                      <Textarea
                        rows={3}
                        placeholder="Section text..."
                        value={section.body}
                        onChange={(e) => updateSection(section.id, { body: e.target.value })}
                      />
                    ) : (
                      <div className="space-y-2">
                        {section.bullets.map((bullet, bi) => (
                          <div key={bi} className="flex gap-2 items-center">
                            <span className="text-gray-400">•</span>
                            <Input
                              placeholder={`Point ${bi + 1}...`}
                              value={bullet}
                              onChange={(e) => updateBullet(section.id, bi, e.target.value)}
                            />
                            {section.bullets.length > 1 && (
                              <Button type="button" variant="outline" size="sm" onClick={() => removeBullet(section.id, bi)}>
                                <X className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={() => addBullet(section.id)}>
                          <Plus className="w-4 h-4 mr-1" />
                          Add Point
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
                {sections.length === 0 && (
                  <p className="text-sm text-gray-500 italic">No sections yet — click “Add Section” to start.</p>
                )}
              </div>
            </div>

            {/* Role Type */}
            <div>
              <Label className="text-base font-semibold">Role Type (optional)</Label>
              <p className="text-xs text-gray-500 mb-3">Select the role type for the bulletin contact</p>
              <div className="flex gap-2 mt-2 flex-wrap">
                {ROLE_OPTIONS.map(role => (
                  <Badge
                    key={role}
                    className={`cursor-pointer ${
                      roleTypes.includes(role)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                    }`}
                    onClick={() => {
                      if (roleTypes.includes(role)) {
                        setRoleTypes(roleTypes.filter(r => r !== role));
                      } else {
                        setRoleTypes([...roleTypes, role]);
                      }
                    }}
                  >
                    {role}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Problem/Failure Images */}
            <div>
              <Label className="text-base font-semibold">Problem/Failure Images (optional)</Label>
              <p className="text-xs text-gray-500 mb-3">Upload images showing the failure or concern</p>
              
              <label htmlFor="problem-image-upload">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('problem-image-upload')?.click()}
                >
                  <Upload className="w-4 h-4 mr-1" />
                  Upload Problem Images
                </Button>
              </label>
              <input
                id="problem-image-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleProblemImageUpload}
              />
              
              {problemImages.length > 0 && (
                <div className="space-y-3 mt-4">
                  {problemImages.map((image, index) => (
                    <div key={index} className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <img 
                          src={image.url} 
                          alt={`Problem ${index + 1}`}
                          className="w-20 h-20 object-cover rounded border border-red-300"
                        />
                        <div className="flex-1">
                          <Input
                            placeholder={`Caption for problem image ${index + 1} (optional)...`}
                            value={image.caption}
                            onChange={(e) => updateProblemImageCaption(index, e.target.value)}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeProblemImage(index)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Fix/Solution Images */}
            <div>
              <Label className="text-base font-semibold">Fix/Solution Images (optional)</Label>
              <p className="text-xs text-gray-500 mb-3">Upload images showing the fix or solution</p>
              
              <label htmlFor="fix-image-upload">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('fix-image-upload')?.click()}
                >
                  <Upload className="w-4 h-4 mr-1" />
                  Upload Fix Images
                </Button>
              </label>
              <input
                id="fix-image-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFixImageUpload}
              />
              
              {fixImages.length > 0 && (
                <div className="space-y-3 mt-4">
                  {fixImages.map((image, index) => (
                    <div key={index} className="border border-green-200 bg-green-50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <img 
                          src={image.url} 
                          alt={`Fix ${index + 1}`}
                          className="w-20 h-20 object-cover rounded border border-green-300"
                        />
                        <div className="flex-1">
                          <Input
                            placeholder={`Caption for fix image ${index + 1} (optional)...`}
                            value={image.caption}
                            onChange={(e) => updateFixImageCaption(index, e.target.value)}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeFixImage(index)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Generate Button */}
            <div className="pt-4 border-t space-y-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Export PDF</p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => handleGeneratePDF(false)}
                  disabled={generating}
                  size="lg"
                  variant="outline"
                  className="w-full border-gray-900 text-gray-900 dark:text-gray-100 hover:bg-gray-900 hover:text-white"
                >
                  {generatingVariant === 'standard' ? (
                    <>Generating…</>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Standard (Multi-page)
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => handleGeneratePDF(true)}
                  disabled={generating}
                  size="lg"
                  className="w-full bg-gray-900 hover:bg-gray-700 text-white"
                >
                  {generatingVariant === 'compact' ? (
                    <>Generating…</>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Compact (One-page)
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-gray-400">Compact mode targets a single page — tighter spacing, side-panel image, condensed layout.</p>
              {isEditMode ? (
                <p className="text-xs text-gray-400">Generated PDFs are also saved to this bulletin so you can grab them anytime below.</p>
              ) : (
                <p className="text-xs text-gray-400">Save the bulletin first to keep its generated PDFs on the entry.</p>
              )}
            </div>

            {/* Saved Documents — previously generated PDFs stored on this bulletin */}
            {isEditMode && storedReports.length > 0 && (
              <div className="pt-4 border-t space-y-2">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Saved Documents</p>
                <div className="space-y-2">
                  {storedReports.map((report) => (
                    <div
                      key={report.row_id}
                      className="flex items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-gray-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {report.report_type} PDF
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {report.file_name}
                            {report.generated_at
                              ? ` · ${new Date(report.generated_at).toLocaleString()}`
                              : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Open"
                          onClick={() => openStoredReport(report, false)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Download"
                          onClick={() => openStoredReport(report, true)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save Button */}
            <div className="pt-4 border-t">
              <Button
                onClick={handleSave}
                disabled={saving}
                size="lg"
                className="w-full"
              >
                {saving ? (
                  <>Saving...</>
                ) : (
                  <>
                    <Save className="w-5 h-5 mr-2" />
                    {isEditMode ? 'Update Bulletin' : 'Save Bulletin'}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Preview Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-300">Bulletin:</span>
                <span className="font-mono">TB-{isEditMode ? bulletinNumber : (nextNumberPreview || '___')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-300">Type:</span>
                <span>{BULLETIN_TYPE_OPTIONS.find(t => t.value === bulletinType)?.label || bulletinType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-300">Severity:</span>
                <Badge className={getSeverityColor(severity)}>{severity}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-300">Products:</span>
                <span>{affectedProducts.length > 0 ? affectedProducts.length : 'All'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-300">Sections:</span>
                <span>{cleanedSections().length}</span>
              </div>
            </div>
          </CardContent>
        </Card>
          </>
        )}
      </div>
    </div>
  );
}