import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { projectId, publicAnonKey } from '/utils/supabase/info';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Database, Download, Table as TableIcon } from 'lucide-react';
import { toast } from 'sonner';

export default function Import() {
  const { accessToken, user } = useAuth();
  const [tableName, setTableName] = useState('');
  const [tableData, setTableData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [importType, setImportType] = useState('');
  
  // Field mappings for customers
  const [customerMapping, setCustomerMapping] = useState({
    name: '',
    logo: ''
  });

  // Field mappings for sales
  const [salesMapping, setSalesMapping] = useState({
    customerId: '',
    customerName: '',
    districtId: '',
    districtName: '',
    weekEnding: '',
    barrels: '',
    stages: '',
    notes: ''
  });

  // Field mappings for districts
  const [districtMapping, setDistrictMapping] = useState({
    customerId: '',
    customerName: '',
    name: '',
    address: '',
    contactName: '',
    phone: '',
    email: ''
  });

  // Field mappings for field visits
  const [fieldVisitMapping, setFieldVisitMapping] = useState({
    customerId: '',
    customerName: '',
    districtId: '',
    districtName: '',
    date: '',
    visitType: '',
    hours: '',
    sqmName: '',
    sqmId: '',
    summary: '',
    notes: '',
    trainingTopics: '',
    attendees: ''
  });

  // Field mappings for incidents
  const [incidentMapping, setIncidentMapping] = useState({
    customerId: '',
    customerName: '',
    districtId: '',
    districtName: '',
    date: '',
    severity: '',
    summary: '',
    description: '',
    rootCause: '',
    correctiveActions: '',
    preventativeActions: '',
    investigator: '',
    investigatorId: ''
  });

  // Field mappings for panels
  const [panelMapping, setPanelMapping] = useState({
    serialNumber: '',
    model: '',
    customerId: '',
    customerName: '',
    districtId: '',
    districtName: '',
    status: '',
    installationDate: '',
    notes: ''
  });

  const handleQueryTable = async () => {
    if (!tableName) {
      toast.error('Please enter a table name');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-64775d98/import/query`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken ?? publicAnonKey}`,
          },
          body: JSON.stringify({ tableName, limit: 10 }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to query table');
      }

      setTableData(result.data || []);
      toast.success(`Found ${result.count} records (showing first 10)`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to query table');
      console.error('Error querying table:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!tableName || !importType) {
      toast.error('Please select table and import type');
      return;
    }

    setLoading(true);
    try {
      const mappingMap: Record<string, any> = {
        customers: customerMapping,
        sales: salesMapping,
        districts: districtMapping,
        fieldVisits: fieldVisitMapping,
        incidents: incidentMapping,
        panels: panelMapping
      };
      
      const mapping = mappingMap[importType];
      
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-64775d98/import/${importType}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken ?? publicAnonKey}`,
          },
          body: JSON.stringify({ tableName, mapping }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to import data');
      }

      toast.success(`Successfully imported ${result.imported} records`);
      setTableData([]);
      setTableName('');
      setImportType('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to import data');
      console.error('Error importing data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center py-12">
          <p className="text-gray-600">Only administrators can access this page.</p>
        </div>
      </div>
    );
  }

  const columns = tableData.length > 0 ? Object.keys(tableData[0]) : [];

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Import Data</h1>
          <p className="text-gray-600 mt-2">Import data from existing Supabase tables</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Import Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="tableName">Table Name</Label>
                  <Input
                    id="tableName"
                    value={tableName}
                    onChange={(e) => setTableName(e.target.value)}
                    placeholder="e.g., customers"
                  />
                </div>

                <Button 
                  className="w-full" 
                  onClick={handleQueryTable}
                  disabled={loading || !tableName}
                >
                  <TableIcon className="w-4 h-4 mr-2" />
                  {loading ? 'Querying...' : 'Preview Table Data'}
                </Button>

                {tableData.length > 0 && (
                  <>
                    <div className="pt-4 border-t">
                      <Label htmlFor="importType">Import As</Label>
                      <Select value={importType} onValueChange={setImportType}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select data type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="customers">Customers</SelectItem>
                          <SelectItem value="sales">Sales Data</SelectItem>
                          <SelectItem value="districts">Districts</SelectItem>
                          <SelectItem value="fieldVisits">Field Visits</SelectItem>
                          <SelectItem value="incidents">Incidents</SelectItem>
                          <SelectItem value="panels">Panels</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {importType === 'customers' && (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Map Customer Fields:</p>
                        {Object.keys(customerMapping).map((field) => (
                          <div key={field}>
                            <Label className="text-xs">{field}</Label>
                            <Select
                              value={customerMapping[field as keyof typeof customerMapping]}
                              onValueChange={(value) =>
                                setCustomerMapping({ ...customerMapping, [field]: value })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select column" />
                              </SelectTrigger>
                              <SelectContent>
                                {columns.map((col) => (
                                  <SelectItem key={col} value={col}>
                                    {col}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    )}

                    {importType === 'sales' && (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        <p className="text-sm font-medium">Map Sales Fields:</p>
                        {Object.keys(salesMapping).map((field) => (
                          <div key={field}>
                            <Label className="text-xs">{field}</Label>
                            <Select
                              value={salesMapping[field as keyof typeof salesMapping]}
                              onValueChange={(value) =>
                                setSalesMapping({ ...salesMapping, [field]: value })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select column" />
                              </SelectTrigger>
                              <SelectContent>
                                {columns.map((col) => (
                                  <SelectItem key={col} value={col}>
                                    {col}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    )}

                    {importType === 'districts' && (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        <p className="text-sm font-medium">Map District Fields:</p>
                        {Object.keys(districtMapping).map((field) => (
                          <div key={field}>
                            <Label className="text-xs">{field}</Label>
                            <Select
                              value={districtMapping[field as keyof typeof districtMapping]}
                              onValueChange={(value) =>
                                setDistrictMapping({ ...districtMapping, [field]: value })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select column" />
                              </SelectTrigger>
                              <SelectContent>
                                {columns.map((col) => (
                                  <SelectItem key={col} value={col}>
                                    {col}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    )}

                    {importType === 'fieldVisits' && (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        <p className="text-sm font-medium">Map Field Visit Fields:</p>
                        {Object.keys(fieldVisitMapping).map((field) => (
                          <div key={field}>
                            <Label className="text-xs">{field}</Label>
                            <Select
                              value={fieldVisitMapping[field as keyof typeof fieldVisitMapping]}
                              onValueChange={(value) =>
                                setFieldVisitMapping({ ...fieldVisitMapping, [field]: value })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select column" />
                              </SelectTrigger>
                              <SelectContent>
                                {columns.map((col) => (
                                  <SelectItem key={col} value={col}>
                                    {col}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    )}

                    {importType === 'incidents' && (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        <p className="text-sm font-medium">Map Incident Fields:</p>
                        {Object.keys(incidentMapping).map((field) => (
                          <div key={field}>
                            <Label className="text-xs">{field}</Label>
                            <Select
                              value={incidentMapping[field as keyof typeof incidentMapping]}
                              onValueChange={(value) =>
                                setIncidentMapping({ ...incidentMapping, [field]: value })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select column" />
                              </SelectTrigger>
                              <SelectContent>
                                {columns.map((col) => (
                                  <SelectItem key={col} value={col}>
                                    {col}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    )}

                    {importType === 'panels' && (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        <p className="text-sm font-medium">Map Panel Fields:</p>
                        {Object.keys(panelMapping).map((field) => (
                          <div key={field}>
                            <Label className="text-xs">{field}</Label>
                            <Select
                              value={panelMapping[field as keyof typeof panelMapping]}
                              onValueChange={(value) =>
                                setPanelMapping({ ...panelMapping, [field]: value })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select column" />
                              </SelectTrigger>
                              <SelectContent>
                                {columns.map((col) => (
                                  <SelectItem key={col} value={col}>
                                    {col}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    )}

                    {importType && (
                      <Button 
                        className="w-full" 
                        onClick={handleImport}
                        disabled={loading}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        {loading ? 'Importing...' : 'Import Data'}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            {tableData.length === 0 ? (
              <Card className="h-full">
                <CardContent className="flex flex-col items-center justify-center h-full min-h-[400px] text-gray-500">
                  <Database className="w-16 h-16 mb-4 text-gray-400" />
                  <p className="text-lg font-medium">No Data Preview</p>
                  <p className="text-sm mt-2">Enter a table name and click Preview to see your data</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Table Preview: {tableName}</CardTitle>
                  <p className="text-sm text-gray-500">Showing first 10 records</p>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {columns.map((col) => (
                            <th key={col} className="px-4 py-2 text-left font-medium text-gray-700">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableData.map((row, idx) => (
                          <tr key={idx} className="border-t">
                            {columns.map((col) => (
                              <td key={col} className="px-4 py-2 text-gray-600">
                                {row[col] !== null && row[col] !== undefined 
                                  ? String(row[col]).substring(0, 50) 
                                  : '-'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}