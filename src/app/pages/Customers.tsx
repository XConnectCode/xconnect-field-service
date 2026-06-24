import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../lib/auth-context';
import { customerApi, districtApi, salesApi, incidentApi } from '../lib/api';
import { customerLogoUrl } from '../lib/customerLogo';
import { Link, useNavigate } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Combobox } from '../components/ui/combobox';
import { Plus, Building2, MapPin, Droplet, Layers, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

// Customer Management Page - Card Layout (Updated)
export default function Customers() {
  const { accessToken, user } = useAuth();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [districts, setDistricts] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [districtDialogOpen, setDistrictDialogOpen] = useState(false);
  const [districtCustomerId, setDistrictCustomerId] = useState('');

  useEffect(() => {
    if (accessToken) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [accessToken]);

  const loadData = async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    
    try {
      const [customersData, allDistrictsData, salesData, incidentsData] = await Promise.all([
        customerApi.getAll(accessToken),
        districtApi.getAll(accessToken),
        salesApi.getAll(accessToken).catch(() => []),
        incidentApi.getAll(accessToken).catch(() => [])
      ]);
      
      console.log('Loaded customers:', customersData);
      console.log('Loaded all districts:', allDistrictsData);
      
      // Log the first district to see all its fields
      if (allDistrictsData && allDistrictsData.length > 0) {
        console.log('Sample district data:', allDistrictsData[0]);
        console.log('District fields:', Object.keys(allDistrictsData[0]));
      }
      
      setCustomers(customersData || []);
      setDistricts(allDistrictsData || []);
      setSales(Array.isArray(salesData) ? salesData : (salesData?.sales || []));
      setIncidents(Array.isArray(incidentsData) ? incidentsData : (incidentsData?.incidents || []));
    } catch (error: any) {
      console.error('Error loading data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    
    try {
      await customerApi.create({
        customer: formData.get('name'),
        customer_logo: formData.get('logo'),
      }, accessToken || undefined);
      
      toast.success('Customer added successfully');
      setCustomerDialogOpen(false);
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add customer');
    }
  };

  const handleAddDistrict = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    
    const customerId = formData.get('customerId') as string;
    const customer = customers.find(c => c.row_id === customerId);
    
    try {
      await districtApi.create({
        customer: customerId,
        customer_district: formData.get('name'),
        customer_address: formData.get('address'),
        district_contact: formData.get('contactName'),
        customer_phone_number: formData.get('phone'),
        customer_email: formData.get('email'),
      }, accessToken || undefined);
      
      toast.success('District added successfully');
      setDistrictDialogOpen(false);
      setDistrictCustomerId('');
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add district');
    }
  };

  // Per-customer rollups: barrels / stages / incidents / xc-caused, keyed by customer NAME
  // (sales + incidents store the customer NAME in customerName, not the row_id).
  const rollupByName = useMemo(() => {
    const map: Record<string, { barrels: number; stages: number; incidents: number; xcCaused: number }> = {};
    const ensure = (name: string) => (map[name] = map[name] || { barrels: 0, stages: 0, incidents: 0, xcCaused: 0 });
    sales.forEach(s => {
      if (!s.customerName) return;
      const r = ensure(s.customerName);
      r.barrels += Number(s.barrels) || 0;
      r.stages += Number(s.stages) || 0;
    });
    incidents.forEach(i => {
      if (!i.customerName) return;
      const r = ensure(i.customerName);
      r.incidents += 1;
      if (i.xc_caused === 'Yes') r.xcCaused += 1;
    });
    return map;
  }, [sales, incidents]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="max-w-7xl mx-auto text-center py-12">Loading...</div>
      </div>
    );
  }

  // Group districts by customer
  const customersWithDistricts = customers.map(customer => ({
    ...customer,
    districts: districts.filter(d => d.customer === customer.row_id),
    rollup: rollupByName[customer.customer] || { barrels: 0, stages: 0, incidents: 0, xcCaused: 0 }
  }));

  console.log('Rendering Customers page with card layout - customers:', customersWithDistricts.length);

  return (
    <div className="p-8">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Customers & Districts</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-2">Manage your wireline company customers and their districts</p>
          </div>
          {user?.role === 'admin' && (
            <div className="flex gap-3">
              <Dialog open={districtDialogOpen} onOpenChange={setDistrictDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" disabled={customers.length === 0}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add District
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New District</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleAddDistrict} className="space-y-4">
                    <div>
                      <Label htmlFor="customerId">Customer</Label>
                      <input type="hidden" name="customerId" value={districtCustomerId} />
                      <Combobox
                        value={districtCustomerId}
                        onValueChange={setDistrictCustomerId}
                        options={customers.map((customer) => ({ value: customer.row_id, label: customer.customer }))}
                        placeholder="Select customer"
                        searchPlaceholder="Search customers…"
                        emptyText="No customers found."
                      />
                    </div>
                    <div>
                      <Label htmlFor="name">District Name</Label>
                      <Input id="name" name="name" required />
                    </div>
                    <div>
                      <Label htmlFor="address">Address</Label>
                      <Input id="address" name="address" required />
                    </div>
                    <div>
                      <Label htmlFor="contactName">Contact Person</Label>
                      <Input id="contactName" name="contactName" required />
                    </div>
                    <div>
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" name="phone" type="tel" required />
                    </div>
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" name="email" type="email" required />
                    </div>
                    <Button type="submit" className="w-full">Add District</Button>
                  </form>
                </DialogContent>
              </Dialog>
              
              <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Customer
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Customer</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleAddCustomer} className="space-y-4">
                    <div>
                      <Label htmlFor="name">Company Name</Label>
                      <Input id="name" name="name" required />
                    </div>
                    <div>
                      <Label htmlFor="logo">Logo URL</Label>
                      <Input id="logo" name="logo" placeholder="https://example.com/logo.png" required />
                    </div>
                    <Button type="submit" className="w-full">Add Customer</Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        {/* Empty State */}
        {customers.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12 text-gray-500">
              <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-semibold mb-2">No customers yet</h3>
              <p className="mb-6">Add your first customer to start tracking field service activities</p>
              {user?.role === 'admin' && (
                <Button onClick={() => setCustomerDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Customer
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {customersWithDistricts.map((customer) => {
              const logoUrl = customerLogoUrl(customer.customer_logo);
              return (
                <Link
                  key={customer.row_id}
                  to={`/customers/${customer.row_id}`}
                  className="block"
                >
                  <Card className="overflow-hidden h-full hover:shadow-lg transition-shadow cursor-pointer">
                    {/* Logo focal point */}
                    <div className="h-32 flex items-center justify-center bg-white dark:bg-gray-800 border-b dark:border-gray-700 p-4">
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt={customer.customer}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <div className="flex items-center justify-center w-24 h-24 rounded-lg bg-gray-100 dark:bg-gray-700">
                          <Building2 className="w-12 h-12 text-gray-400" />
                        </div>
                      )}
                    </div>

                    <CardHeader className="text-center pb-3">
                      <CardTitle className="text-lg text-gray-900 dark:text-gray-100 truncate">{customer.customer}</CardTitle>
                      <p className="flex items-center justify-center gap-1 text-sm text-gray-600 dark:text-gray-300 mt-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {customer.districts.length} {customer.districts.length === 1 ? 'district' : 'districts'}
                      </p>
                    </CardHeader>

                    <CardContent className="pt-0">
                      {/* Clickable rollup KPI pills */}
                      <div className="flex flex-wrap justify-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigate(`/sales?customerName=${encodeURIComponent(customer.customer)}`); }}
                          className="flex items-center gap-1 rounded-full bg-white dark:bg-gray-900/60 border border-indigo-100 dark:border-gray-600 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300 shadow-sm hover:shadow hover:border-indigo-300 transition-all"
                          title="View sales volume for this customer"
                        >
                          <Droplet className="w-3.5 h-3.5" /> {customer.rollup.barrels.toLocaleString()} bbl
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigate(`/sales?customerName=${encodeURIComponent(customer.customer)}`); }}
                          className="flex items-center gap-1 rounded-full bg-white dark:bg-gray-900/60 border border-blue-100 dark:border-gray-600 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 shadow-sm hover:shadow hover:border-blue-300 transition-all"
                          title="View stages for this customer"
                        >
                          <Layers className="w-3.5 h-3.5" /> {customer.rollup.stages.toLocaleString()} stages
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigate(`/incidents?customerName=${encodeURIComponent(customer.customer)}`); }}
                          className="flex items-center gap-1 rounded-full bg-white dark:bg-gray-900/60 border border-red-100 dark:border-gray-600 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-300 shadow-sm hover:shadow hover:border-red-300 transition-all"
                          title="View incidents for this customer"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" /> {customer.rollup.incidents} incidents
                          {customer.rollup.xcCaused > 0 && (
                            <span className="ml-1 rounded-full bg-red-600 text-white px-1.5 py-0.5 text-[10px] leading-none">{customer.rollup.xcCaused} XC</span>
                          )}
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}