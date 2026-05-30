import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth-context';
import { detailApi } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Monitor, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import ImageUpload from '../components/ImageUpload';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';

export default function PanelDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { accessToken } = useAuth();
  const [panel, setPanel] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPanel();
  }, [id]);

  const loadPanel = async () => {
    if (!id || !accessToken) {
      setLoading(false);
      return;
    }

    try {
      const data = await detailApi.getPanel(id, accessToken);
      setPanel(data);
    } catch (error: any) {
      console.error('Error loading panel:', error);
      toast.error('Failed to load panel details');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8"><div className="max-w-5xl mx-auto text-center py-12">Loading...</div></div>;
  }

  if (!panel) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-12">
          <p className="text-gray-500 mb-4">Panel not found</p>
          <Button onClick={() => navigate('/panels')}>Back to Panels</Button>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'installed': return 'bg-green-100 text-green-800';
      case 'in stock': return 'bg-blue-100 text-blue-800';
      case 'in transit': return 'bg-yellow-100 text-yellow-800';
      case 'maintenance': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate('/panels')} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Panels
          </Button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Panel Details</h1>
              <p className="text-gray-600 mt-2">{panel['serial#'] || 'N/A'}</p>
            </div>
            <Badge className={getStatusColor(panel.panel_status)}>
              {panel.panel_status || 'Unknown'}
            </Badge>
          </div>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader><CardTitle>Panel Information</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div><label className="text-sm font-medium text-gray-500">Customer</label>
                <p className="text-gray-900 mt-1">{panel.customerName || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">District</label>
                <p className="text-gray-900 mt-1">{panel.districtName || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">Panel Type</label>
                <p className="text-gray-900 mt-1">{panel.panel_type || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">Plus Panel</label>
                <p className="text-gray-900 mt-1">{panel.plus_panel || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">Unit #</label>
                <p className="text-gray-900 mt-1">{panel['unit#'] || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">SO #</label>
                <p className="text-gray-900 mt-1">{panel['so#'] || 'N/A'}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Firmware Versions</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div><label className="text-sm font-medium text-gray-500">Shooting FW</label>
                <p className="text-gray-900 mt-1">{panel.shootingfw || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">WL Control FW</label>
                <p className="text-gray-900 mt-1">{panel.wl_controlfw || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">Logging FW</label>
                <p className="text-gray-900 mt-1">{panel.loggingfw || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">GUI #</label>
                <p className="text-gray-900 mt-1">{panel.gui_version || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">Surface FW</label>
                <p className="text-gray-900 mt-1">{panel.surfacefw || 'N/A'}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Tracking & Status</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div><label className="text-sm font-medium text-gray-500">Received Date</label>
                <div className="flex items-center gap-2 mt-1">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <p className="text-gray-900">{panel.received_date ? new Date(panel.received_date).toLocaleDateString() : 'N/A'}</p>
                </div></div>
              <div><label className="text-sm font-medium text-gray-500">Last Updated</label>
                <div className="flex items-center gap-2 mt-1">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <p className="text-gray-900">{panel.date_updated ? new Date(panel.date_updated).toLocaleDateString() : 'N/A'}</p>
                </div></div>
              <div><label className="text-sm font-medium text-gray-500">XC Base</label>
                <p className="text-gray-900 mt-1">{panel.xc_base || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">Activity</label>
                <p className="text-gray-900 mt-1">{panel.activity || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">RMA</label>
                <p className="text-gray-900 mt-1">{panel.rma || 'N/A'}</p></div>
              <div><label className="text-sm font-medium text-gray-500">Spare?</label>
                <p className="text-gray-900 mt-1">{panel['spare?'] || 'N/A'}</p></div>
            </CardContent>
          </Card>

          {panel.comments && (
            <Card>
              <CardHeader><CardTitle>Comments</CardTitle></CardHeader>
              <CardContent>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <pre className="whitespace-pre-wrap text-sm text-gray-900 font-sans">{panel.comments}</pre>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Panel Images (polymorphic) ── */}
          {panel?.row_id && (
            <Card>
              <CardHeader><CardTitle>Images</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <ImageUpload
                  parentTable="panels"
                  parentRowId={panel.row_id}
                  baseUrl={`https://${projectId}.supabase.co/functions/v1/make-server-64775d98`}
                  publicAnonKey={publicAnonKey}
                  autoLoad
                  maxImages={10}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
