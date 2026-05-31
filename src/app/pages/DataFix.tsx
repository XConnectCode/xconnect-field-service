import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';

export default function DataFix() {
  const { accessToken } = useAuth();
  const [fixing, setFixing] = useState(false);
  const [results, setResults] = useState<any>(null);

  const fixAllData = async () => {
    if (!accessToken) {
      toast.error('Please log in first');
      return;
    }

    setFixing(true);
    setResults(null);

    try {
      const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

      // Load all data
      const [customersRes, districtsRes, visitsRes, incidentsRes, salesRes, panelsRes] = await Promise.all([
        fetch(`${baseUrl}/customers`, {
          headers: { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` }
        }),
        fetch(`${baseUrl}/districts`, {
          headers: { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` }
        }),
        fetch(`${baseUrl}/field-visits`, {
          headers: { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` }
        }),
        fetch(`${baseUrl}/incidents`, {
          headers: { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` }
        }),
        fetch(`${baseUrl}/sales`, {
          headers: { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` }
        }),
        fetch(`${baseUrl}/panels`, {
          headers: { 'Authorization': `Bearer ${accessToken ?? publicAnonKey}` }
        }),
      ]);

      const customers = (await customersRes.json()).customers || [];
      const districts = (await districtsRes.json()).districts || [];
      const visits = (await visitsRes.json()).visits || [];
      const incidents = (await incidentsRes.json()).incidents || [];
      const sales = (await salesRes.json()).sales || [];
      const panels = (await panelsRes.json()).panels || [];

      // Create lookup maps
      const customerMap = new Map(customers.map((c: any) => [c.id, c.name]));
      const districtMap = new Map(districts.map((d: any) => [d.id, d.name]));

      let fixed = {
        visits: 0,
        incidents: 0,
        sales: 0,
        panels: 0,
        districts: 0
      };

      // Fix field visits
      for (const visit of visits) {
        if (!visit.customerName || !visit.districtName) {
          const customerName = customerMap.get(visit.customerId);
          const districtName = districtMap.get(visit.districtId);
          
          if (customerName && districtName) {
            const visitId = visit.id.replace('visit:', '');
            await fetch(`${baseUrl}/field-visits/${visitId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken ?? publicAnonKey}`
              },
              body: JSON.stringify({
                ...visit,
                customerName,
                districtName
              })
            });
            fixed.visits++;
          }
        }
      }

      // Fix incidents
      for (const incident of incidents) {
        if (!incident.customerName || !incident.districtName) {
          const customerName = customerMap.get(incident.customerId);
          const districtName = districtMap.get(incident.districtId);
          
          if (customerName && districtName) {
            const incidentId = incident.id.replace('incident:', '');
            await fetch(`${baseUrl}/incidents/${incidentId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken ?? publicAnonKey}`
              },
              body: JSON.stringify({
                ...incident,
                customerName,
                districtName
              })
            });
            fixed.incidents++;
          }
        }
      }

      // Fix sales
      for (const sale of sales) {
        if (!sale.customerName || !sale.districtName) {
          const customerName = customerMap.get(sale.customerId);
          const districtName = districtMap.get(sale.districtId);
          
          if (customerName && districtName) {
            const saleId = sale.id.replace('sales:', '');
            await fetch(`${baseUrl}/sales/${saleId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken ?? publicAnonKey}`
              },
              body: JSON.stringify({
                ...sale,
                customerName,
                districtName
              })
            });
            fixed.sales++;
          }
        }
      }

      // Fix panels
      for (const panel of panels) {
        if (!panel.customerName || !panel.districtName) {
          const customerName = customerMap.get(panel.customerId);
          const districtName = districtMap.get(panel.districtId);
          
          if (customerName && districtName) {
            const panelId = panel.id.replace('panel:', '');
            await fetch(`${baseUrl}/panels/${panelId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken ?? publicAnonKey}`
              },
              body: JSON.stringify({
                ...panel,
                customerName,
                districtName
              })
            });
            fixed.panels++;
          }
        }
      }

      // Fix districts (populate customerName if missing)
      for (const district of districts) {
        if (!district.customerName) {
          const customerName = customerMap.get(district.customerId);
          
          if (customerName) {
            const districtId = district.id.replace(/^district:[^:]+:/, '');
            await fetch(`${baseUrl}/districts/${districtId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken ?? publicAnonKey}`
              },
              body: JSON.stringify({
                ...district,
                customerName
              })
            });
            fixed.districts++;
          }
        }
      }

      setResults(fixed);
      toast.success('Data fixed successfully!');
    } catch (error: any) {
      console.error('Error fixing data:', error);
      toast.error('Failed to fix data: ' + error.message);
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Data Fix Utility</h1>
          <p className="text-gray-600 mt-2">
            Fix records that are displaying UUIDs instead of names
          </p>
        </div>

        <Alert className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This utility will scan all your data (field visits, incidents, sales, panels, and districts) 
            and populate missing customer/district names by looking up the corresponding IDs. 
            This is safe to run and will only update records that are missing name fields.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Fix Missing Names</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              Click the button below to automatically fix all records that are showing UUIDs 
              instead of customer/district names.
            </p>

            <Button 
              onClick={fixAllData} 
              disabled={fixing}
              className="w-full"
            >
              {fixing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Fixing Data...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Fix All Data
                </>
              )}
            </Button>

            {results && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <h3 className="font-semibold text-green-900">Fix Complete!</h3>
                </div>
                <div className="space-y-1 text-sm text-green-800">
                  <p>• Fixed {results.visits} field visit(s)</p>
                  <p>• Fixed {results.incidents} incident(s)</p>
                  <p>• Fixed {results.sales} sales record(s)</p>
                  <p>• Fixed {results.panels} panel(s)</p>
                  <p>• Fixed {results.districts} district(s)</p>
                </div>
                <p className="mt-3 text-sm font-medium text-green-900">
                  Total records fixed: {Object.values(results).reduce((a: number, b: number) => a + b, 0)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>How It Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-gray-600">
              <p>1. Loads all customers and districts to create a lookup table</p>
              <p>2. Scans all field visits, incidents, sales, panels, and districts</p>
              <p>3. For each record missing a customerName or districtName, looks up the ID</p>
              <p>4. Updates the record with the correct name</p>
              <p>5. Your data will now show proper names instead of UUIDs</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
