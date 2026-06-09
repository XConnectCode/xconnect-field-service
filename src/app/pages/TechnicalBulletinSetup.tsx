import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Database, ExternalLink, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

export default function TechnicalBulletinSetup() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const rlsFixSql = `ALTER TABLE technical_bulletins DISABLE ROW LEVEL SECURITY;
ALTER TABLE technical_bulletins ADD COLUMN IF NOT EXISTS customer_file_url TEXT;
ALTER TABLE technical_bulletins ADD COLUMN IF NOT EXISTS customer_file_label TEXT;`;

  const sqlCode = `-- Copy this SQL and run it in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS technical_bulletins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulletin_number TEXT NOT NULL,
  bulletin_type TEXT NOT NULL DEFAULT 'Informational',
  sections JSONB DEFAULT '[]',
  title TEXT NOT NULL,
  date DATE NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low', 'Information')),
  affected_products TEXT[] DEFAULT '{}',
  affected_parts TEXT[] DEFAULT '{}',
  distribution_list TEXT[] DEFAULT '{}',
  summary TEXT NOT NULL,
  background TEXT,
  technical_details TEXT NOT NULL,
  recommended_actions TEXT[] NOT NULL DEFAULT '{}',
  role_types TEXT[] DEFAULT '{}',
  problem_images JSONB DEFAULT '[]',
  fix_images JSONB DEFAULT '[]',
  customer_file_url TEXT,
  customer_file_label TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- If the table already exists, add the columns (safe to run multiple times):
ALTER TABLE technical_bulletins ADD COLUMN IF NOT EXISTS customer_file_url TEXT;
ALTER TABLE technical_bulletins ADD COLUMN IF NOT EXISTS customer_file_label TEXT;
ALTER TABLE technical_bulletins ADD COLUMN IF NOT EXISTS bulletin_type TEXT NOT NULL DEFAULT 'Informational';
ALTER TABLE technical_bulletins ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_technical_bulletins_bulletin_number ON technical_bulletins(bulletin_number);
CREATE INDEX IF NOT EXISTS idx_technical_bulletins_date ON technical_bulletins(date DESC);
CREATE INDEX IF NOT EXISTS idx_technical_bulletins_severity ON technical_bulletins(severity);
CREATE INDEX IF NOT EXISTS idx_technical_bulletins_type ON technical_bulletins(bulletin_type);

-- Disable RLS to allow all operations
ALTER TABLE technical_bulletins DISABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "Allow all users to read bulletins" ON technical_bulletins;
DROP POLICY IF EXISTS "Allow all users to insert bulletins" ON technical_bulletins;
DROP POLICY IF EXISTS "Allow all users to update bulletins" ON technical_bulletins;
DROP POLICY IF EXISTS "Allow all users to delete bulletins" ON technical_bulletins;
DROP POLICY IF EXISTS "Allow authenticated users to read bulletins" ON technical_bulletins;
DROP POLICY IF EXISTS "Allow authenticated users to insert bulletins" ON technical_bulletins;
DROP POLICY IF EXISTS "Allow authenticated users to update bulletins" ON technical_bulletins;
DROP POLICY IF EXISTS "Allow authenticated users to delete bulletins" ON technical_bulletins;

-- =====================================================================
-- Generated-PDF storage (so a saved bulletin keeps its generated docs,
-- just like incidents). Creates a private bucket + a tracking table.
-- Safe to run multiple times.
-- =====================================================================
CREATE TABLE IF NOT EXISTS technical_bulletin_reports (
  row_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulletin_id  UUID NOT NULL REFERENCES technical_bulletins(id) ON DELETE CASCADE,
  report_type  TEXT NOT NULL,            -- 'Standard' | 'Compact'
  file_path    TEXT,
  file_name    TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  generated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_tb_reports_bulletin_id ON technical_bulletin_reports(bulletin_id);
CREATE INDEX IF NOT EXISTS idx_tb_reports_report_type ON technical_bulletin_reports(report_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tb_reports_unique_type ON technical_bulletin_reports(bulletin_id, report_type);
ALTER TABLE technical_bulletin_reports DISABLE ROW LEVEL SECURITY;

-- Private storage bucket for the generated PDFs (25 MB safety cap)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('technical-bulletins', 'technical-bulletins', false, 26214400)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;

-- Authenticated users can read/write the generated PDFs (shared across users)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='technical_bulletins_authenticated_read') THEN
    CREATE POLICY technical_bulletins_authenticated_read ON storage.objects FOR SELECT
      USING (bucket_id = 'technical-bulletins' AND auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='technical_bulletins_authenticated_insert') THEN
    CREATE POLICY technical_bulletins_authenticated_insert ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'technical-bulletins' AND auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='technical_bulletins_authenticated_update') THEN
    CREATE POLICY technical_bulletins_authenticated_update ON storage.objects FOR UPDATE
      USING (bucket_id = 'technical-bulletins' AND auth.role() = 'authenticated')
      WITH CHECK (bucket_id = 'technical-bulletins' AND auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='technical_bulletins_authenticated_delete') THEN
    CREATE POLICY technical_bulletins_authenticated_delete ON storage.objects FOR DELETE
      USING (bucket_id = 'technical-bulletins' AND auth.role() = 'authenticated');
  END IF;
END $$;`;

  const handleCopy = () => {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(sqlCode)
        .then(() => {
          setCopied(true);
          toast.success('SQL copied to clipboard!');
          setTimeout(() => setCopied(false), 3000);
        })
        .catch(() => {
          // Fallback to textarea selection
          fallbackCopy();
        });
    } else {
      // Fallback for browsers that don't support clipboard API
      fallbackCopy();
    }
  };

  const fallbackCopy = () => {
    if (textAreaRef.current) {
      textAreaRef.current.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        toast.success('SQL copied to clipboard!');
        setTimeout(() => setCopied(false), 3000);
      } catch (err) {
        toast.error('Please manually select and copy the SQL');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-800/50">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Database className="w-12 h-12 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Technical Bulletins Setup</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-1">Create the database table in 3 simple steps</p>
          </div>
        </div>

        {/* Instructions Card */}
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-blue-900">Quick Setup Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  1
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-blue-900 mb-2">Copy the SQL below</p>
                  <Button 
                    onClick={handleCopy} 
                    variant="outline" 
                    size="sm"
                    className="bg-white dark:bg-gray-800"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2 text-green-600" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy SQL
                      </>
                    )}
                  </Button>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  2
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-blue-900 mb-2">Open Supabase SQL Editor</p>
                  <Button 
                    onClick={() => window.open('https://supabase.com/dashboard/project/gbllxumuogsncoiaksum/sql/new', '_blank')}
                    variant="outline"
                    size="sm"
                    className="bg-white dark:bg-gray-800"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open SQL Editor
                  </Button>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">
                  3
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-blue-900 mb-1">Paste the SQL and click RUN</p>
                  <p className="text-sm text-blue-800">Then return here and click the button below:</p>
                  <Button 
                    onClick={() => navigate('/technical-bulletins')}
                    className="mt-2 bg-blue-600 hover:bg-blue-700"
                    size="sm"
                  >
                    Go to Technical Bulletins
                  </Button>
                </div>
              </li>
            </ol>
          </CardContent>
        </Card>

        {/* SQL Code */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>SQL Code</span>
              <Button 
                onClick={handleCopy} 
                variant="outline" 
                size="sm"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2 text-green-600" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Hidden textarea for fallback copy */}
            <textarea
              ref={textAreaRef}
              value={sqlCode}
              readOnly
              style={{
                position: 'absolute',
                left: '-9999px',
                opacity: 0,
                pointerEvents: 'none',
              }}
            />
            
            {/* Visible code display */}
            <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
              <pre className="text-sm font-mono">{sqlCode}</pre>
            </div>
          </CardContent>
        </Card>

        {/* RLS Fix Card */}
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-red-800">Already created the table but getting permission errors?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-200">
              If the table exists but saves fail with a <strong>Row-Level Security</strong> error (code 42501),
              run just this one line in the SQL Editor:
            </p>
            <div className="bg-gray-900 text-green-400 text-sm font-mono p-3 rounded select-all">
              {rlsFixSql}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(rlsFixSql).catch(() => {});
                toast.success('Copied!');
              }}
            >
              <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy fix
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="ml-2"
              onClick={() => window.open('https://supabase.com/dashboard/project/gbllxumuogsncoiaksum/sql/new', '_blank')}
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open SQL Editor
            </Button>
          </CardContent>
        </Card>

        {/* Help Card */}
        <Card>
          <CardHeader>
            <CardTitle>Troubleshooting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-gray-700 dark:text-gray-200">
              If you encounter any issues:
            </p>
            <ul className="list-disc list-inside text-gray-600 dark:text-gray-300 space-y-2 ml-4">
              <li>Make sure you're logged into the correct Supabase project</li>
              <li>Verify you have admin/owner permissions</li>
              <li>Check the SQL Editor for any error messages</li>
              <li>If the table already exists, this SQL will skip creating it</li>
            </ul>
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <strong>Note:</strong> This setup only needs to be done once. After the table is created, 
                you can use the Technical Bulletins feature normally.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}