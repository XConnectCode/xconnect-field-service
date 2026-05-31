import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { projectId } from '/utils/supabase/info';
import { getBearerToken } from '../lib/authHeaders';

export default function Debug() {
  const [counts, setCounts] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

  useEffect(() => {
    loadCounts();
  }, []);

  const loadCounts = async () => {
    try {
      const response = await fetch(`${baseUrl}/debug/row-counts`, {
        headers: {
          'Authorization': `Bearer ${await getBearerToken()}`
        }
      });
      
      const data = await response.json();
      console.log('Debug counts:', data);
      setCounts(data);
    } catch (error) {
      console.error('Error loading counts:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Database Row Counts</h1>
        
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Stages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{counts?.stages?.totalQuantity?.toLocaleString() || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Barrels Sold</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{counts?.barrels_sold?.totalQuantity?.toLocaleString() || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Customers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{counts?.customers || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Districts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{counts?.customer_districts || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Field Visits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{counts?.field_visits || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Incidents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{counts?.incidents || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Panels by Type */}
        <Card>
          <CardHeader>
            <CardTitle>Panels by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {counts?.panels?.total === 0 ? (
              <p className="text-gray-500">No panels found</p>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center pb-3 border-b">
                  <span className="font-semibold">Total Panels</span>
                  <span className="text-2xl font-bold">{counts?.panels?.total || 0}</span>
                </div>
                {counts?.panels?.byType && Object.entries(counts.panels.byType).map(([type, count]: [string, any]) => (
                  <div key={type} className="flex justify-between items-center">
                    <span className="text-gray-700">{type}</span>
                    <span className="font-semibold text-lg">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}