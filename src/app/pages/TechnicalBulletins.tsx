import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { FileText, Plus, Search, Eye, Pencil, Trash2, Download, AlertCircle, Database } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { generateTechnicalBulletinPDF } from '../lib/generateTechnicalBulletinPDF';
import { useAuth } from '../lib/auth-context';

interface TechnicalBulletin {
  id: string;
  bulletin_number: string;
  title: string;
  date: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Information';
  affected_products: string[];
  affected_parts: string[];
  distribution_list: string[];
  summary: string;
  background: string | null;
  technical_details: string;
  recommended_actions: string[];
  role_types: string[];
  problem_images: Array<{ url: string; caption: string }>;
  fix_images: Array<{ url: string; caption: string }>;
  created_at: string;
  updated_at: string;
}

export default function TechnicalBulletins() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [bulletins, setBulletins] = useState<TechnicalBulletin[]>([]);
  const [filteredBulletins, setFilteredBulletins] = useState<TechnicalBulletin[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('All');
  const [tableExists, setTableExists] = useState(true);
  const [rlsError, setRlsError] = useState(false);

  useEffect(() => {
    fetchBulletins();
  }, []);

  useEffect(() => {
    filterBulletins();
  }, [searchTerm, severityFilter, bulletins]);

  const fetchBulletins = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('technical_bulletins')
      .select('*')
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching bulletins:', error);
      if (error.code === 'PGRST205' || error.message?.includes('could not find')) {
        setTableExists(false);
      } else if (error.code === '42501') {
        setRlsError(true);
      }
      toast.error('Failed to load technical bulletins');
    } else {
      setBulletins(data || []);
      setTableExists(true);
    }
    setLoading(false);
  };

  const filterBulletins = () => {
    let filtered = bulletins;

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (bulletin) =>
          bulletin.bulletin_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
          bulletin.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          bulletin.summary.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Severity filter
    if (severityFilter !== 'All') {
      filtered = filtered.filter((bulletin) => bulletin.severity === severityFilter);
    }

    setFilteredBulletins(filtered);
  };

  const handleDelete = async (id: string, bulletinNumber: string) => {
    if (!confirm(`Are you sure you want to delete Technical Bulletin ${bulletinNumber}?`)) {
      return;
    }

    const { error } = await supabase.from('technical_bulletins').delete().eq('id', id);

    if (error) {
      console.error('Error deleting bulletin:', error);
      toast.error('Failed to delete bulletin');
    } else {
      toast.success('Technical bulletin deleted successfully');
      fetchBulletins();
    }
  };

  const handleGeneratePDF = async (bulletin: TechnicalBulletin) => {
    try {
      await generateTechnicalBulletinPDF({
        bulletinNumber: bulletin.bulletin_number,
        title: bulletin.title,
        date: bulletin.date,
        severity: bulletin.severity,
        affectedProducts: bulletin.affected_products,
        failedParts: bulletin.affected_parts.length > 0 ? bulletin.affected_parts : undefined,
        distributionList: bulletin.distribution_list.length > 0 ? bulletin.distribution_list : undefined,
        summary: bulletin.summary,
        background: bulletin.background || undefined,
        technicalDetails: bulletin.technical_details,
        recommendedActions: bulletin.recommended_actions,
        roleType: bulletin.role_types.length > 0 ? bulletin.role_types : undefined,
        problemImages: bulletin.problem_images.length > 0 ? bulletin.problem_images : undefined,
        fixImages: bulletin.fix_images.length > 0 ? bulletin.fix_images : undefined,
        returnBlob: false,
      });
      toast.success('PDF generated successfully!');
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF');
    }
  };

  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'Critical':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'High':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'Medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Low':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'Information':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Technical Bulletins</h1>
            <p className="text-gray-600 mt-1">
              {isAdmin ? 'Manage and distribute technical bulletins' : 'View technical bulletins'}
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => navigate('/technical-bulletin/new')} size="lg">
              <Plus className="w-5 h-5 mr-2" />
              Create New Bulletin
            </Button>
          )}
        </div>

        {/* RLS Error Banner */}
        {rlsError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <AlertCircle className="w-6 h-6 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-red-900 mb-1">Row-Level Security Blocking Access</h3>
                  <p className="text-red-800 text-sm mb-3">
                    The <code className="bg-red-100 px-1 py-0.5 rounded">technical_bulletins</code> table has RLS enabled without permissive policies.
                    Run this one-line fix in the Supabase SQL Editor:
                  </p>
                  <pre className="bg-gray-900 text-green-400 text-xs font-mono p-3 rounded mb-3 select-all">
                    ALTER TABLE technical_bulletins DISABLE ROW LEVEL SECURITY;
                  </pre>
                  <Button
                    size="sm"
                    onClick={() => window.open('https://supabase.com/dashboard/project/gbllxumuogsncoiaksum/sql/new', '_blank')}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    Open Supabase SQL Editor
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Table Not Found Warning */}
        {!tableExists && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <AlertCircle className="w-6 h-6 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900 mb-2">Database Table Not Found</h3>
                  <p className="text-amber-800 text-sm mb-4">
                    The <code className="bg-amber-100 px-1.5 py-0.5 rounded">technical_bulletins</code> table doesn't exist in your database yet.
                    You need to create it before you can use this feature.
                  </p>
                  {isAdmin ? (
                    <div className="flex gap-3">
                      <Button
                        onClick={() => navigate('/technical-bulletin-setup')}
                        variant="default"
                        className="bg-amber-600 hover:bg-amber-700"
                      >
                        <Database className="w-4 h-4 mr-2" />
                        Run Setup Wizard
                      </Button>
                      <Button
                        onClick={() => window.open('https://supabase.com/dashboard/project/gbllxumuogsncoiaksum/sql/new', '_blank')}
                        variant="outline"
                      >
                        Open Supabase SQL Editor
                      </Button>
                    </div>
                  ) : (
                    <p className="text-amber-800 text-sm">
                      Please contact an administrator to enable technical bulletins.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        {tableExists && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4 flex-wrap">
              <div className="flex-1 min-w-[300px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <Input
                    placeholder="Search bulletins..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                {['All', 'Critical', 'High', 'Medium', 'Low', 'Information'].map((severity) => (
                  <Badge
                    key={severity}
                    className={`cursor-pointer ${
                      severityFilter === severity
                        ? getSeverityColor(severity) + ' border-2'
                        : 'bg-gray-100 text-gray-600 border border-gray-300'
                    }`}
                    onClick={() => setSeverityFilter(severity)}
                  >
                    {severity}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Bulletins List */}
        {loading ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              Loading technical bulletins...
            </CardContent>
          </Card>
        ) : filteredBulletins.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                {searchTerm || severityFilter !== 'All'
                  ? 'No bulletins match your filters'
                  : 'No technical bulletins yet'}
              </p>
              {isAdmin && (
                <Button onClick={() => navigate('/technical-bulletin/new')} className="mt-4">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Bulletin
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredBulletins.map((bulletin) => (
              <Card key={bulletin.id} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-mono text-sm font-semibold text-gray-700">
                          TB-{bulletin.bulletin_number}
                        </span>
                        <Badge className={getSeverityColor(bulletin.severity)}>
                          {bulletin.severity}
                        </Badge>
                        <span className="text-sm text-gray-500">
                          {new Date(bulletin.date).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-xl font-semibold text-gray-900 mb-2">
                        {bulletin.title}
                      </h3>
                      <p className="text-gray-600 mb-3 line-clamp-2">{bulletin.summary}</p>
                      <div className="flex gap-4 text-sm text-gray-500">
                        <span>
                          Products: {bulletin.affected_products.length || 'All'}
                        </span>
                        {bulletin.affected_parts.length > 0 && (
                          <span>Parts: {bulletin.affected_parts.length}</span>
                        )}
                        <span>Actions: {bulletin.recommended_actions.length}</span>
                        {bulletin.role_types.length > 0 && (
                          <span>Roles: {bulletin.role_types.length}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/technical-bulletin/${bulletin.id}`)}
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/technical-bulletin/${bulletin.id}/edit`)}
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGeneratePDF(bulletin)}
                        title="Generate PDF"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(bulletin.id, bulletin.bulletin_number)}
                          title="Delete"
                        >
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

        {/* Summary */}
        {!loading && filteredBulletins.length > 0 && (
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-gray-600 text-center">
                Showing {filteredBulletins.length} of {bulletins.length} technical bulletins
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}