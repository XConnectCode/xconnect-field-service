import { projectId, publicAnonKey } from '/utils/supabase/info';
import { supabase } from './supabase';

const API_BASE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-64775d98`;

// Use a hardcoded service role key pattern for direct access
// This bypasses the broken JWT validation
const BYPASS_KEY = 'bypass-auth-temp';

async function apiRequest(endpoint: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  };

  // Forward the signed-in user's access token so the edge function can
  // enforce requireUser/requireAdmin server-side. Prefer an explicitly
  // passed token, then the live Supabase session, then fall back to the
  // anon key (e.g. for public/unauthenticated endpoints). Sending the anon
  // key to a guarded route will (correctly) be rejected with 401.
  let authToken = token;
  if (!authToken) {
    try {
      const { data } = await supabase.auth.getSession();
      authToken = data.session?.access_token;
    } catch {
      // ignore - fall through to anon
    }
  }
  headers['Authorization'] = `Bearer ${authToken || publicAnonKey}`;

  try {
    console.log(`Making API request to ${endpoint}`);
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error Response (${response.status}):`, errorText);
      console.error(`Request headers:`, JSON.stringify(headers, null, 2));
      
      // Provide detailed troubleshooting info
      if (response.status === 401) {
        console.error(`
⚠️  AUTHENTICATION ERROR: The Supabase JWT validation is failing.
📝 This means the Edge Functions need to be redeployed with the current JWT secret.
✅ SOLUTION: In Figma Make, try regenerating the Supabase connection, 
   or manually redeploy the Edge Functions from the Supabase dashboard.
        `);
      }
      
      let error;
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { error: errorText || `HTTP ${response.status}` };
      }
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (error: any) {
    console.error(`API Request failed for ${endpoint}:`, error);
    throw error;
  }
}

// Customer APIs
export const customerApi = {
  getAll: (token?: string) => apiRequest('/customers', {}, token),
  create: (customer: any, token?: string) => 
    apiRequest('/customers', { method: 'POST', body: JSON.stringify(customer) }, token),
};

// District APIs
export const districtApi = {
  getAll: (token?: string) => apiRequest('/districts', {}, token),
  getByCustomer: (customerId: string, token?: string) => 
    apiRequest(`/districts/${customerId}`, {}, token),
  create: (district: any, token?: string) => 
    apiRequest('/districts', { method: 'POST', body: JSON.stringify(district) }, token),
};

// Field Visit APIs
export const fieldVisitApi = {
  getAll: (token?: string) => apiRequest('/field-visits', {}, token),
  create: (visit: any, token?: string) => 
    apiRequest('/field-visits', { method: 'POST', body: JSON.stringify(visit) }, token),
  update: (id: string, updates: any, token?: string) => 
    apiRequest(`/field-visits/${id}`, { method: 'PUT', body: JSON.stringify(updates) }, token),
};

// Incident APIs
export const incidentApi = {
  getAll: (token?: string) => apiRequest('/incidents', {}, token),
  create: (incident: any, token?: string) => 
    apiRequest('/incidents', { method: 'POST', body: JSON.stringify(incident) }, token),
  update: (id: string, updates: any, token?: string) => 
    apiRequest(`/incidents/${id}`, { method: 'PUT', body: JSON.stringify(updates) }, token),
  getReport: (id: string, token?: string) => 
    apiRequest(`/incidents/${id}/report`, {}, token),
};

// Panel APIs
export const panelApi = {
  getAll: (token?: string) => apiRequest('/panels', {}, token),
  create: (panel: any, token?: string) => 
    apiRequest('/panels', { method: 'POST', body: JSON.stringify(panel) }, token),
  update: (id: string, updates: any, token?: string) => 
    apiRequest(`/panels/${id}`, { method: 'PUT', body: JSON.stringify(updates) }, token),
};

// Sales APIs
export const salesApi = {
  getAll: (token?: string) => apiRequest('/sales', {}, token),
  create: (sale: any, token?: string) => 
    apiRequest('/sales', { method: 'POST', body: JSON.stringify(sale) }, token),
};

// KPI APIs
export const kpiApi = {
  getCustomerKPI: (customerId: string, districtId?: string, token?: string) => {
    const endpoint = districtId 
      ? `/kpi/${customerId}/${districtId}` 
      : `/kpi/${customerId}`;
    return apiRequest(endpoint, {}, token);
  },
  getCompanyKPI: (token?: string) => apiRequest('/kpi/company/summary', {}, token),
};

// Driver Loads APIs (hotshot driver checklist)
export const driverLoadApi = {
  getAll: (token?: string) => apiRequest('/driver-loads', {}, token),
  get: (id: string, token?: string) => apiRequest(`/driver-loads/${id}`, {}, token),
  create: (load: any, token?: string) =>
    apiRequest('/driver-loads', { method: 'POST', body: JSON.stringify(load) }, token),
  update: (id: string, updates: any, token?: string) =>
    apiRequest(`/driver-loads/${id}`, { method: 'PUT', body: JSON.stringify(updates) }, token),
  remove: (id: string, token?: string) =>
    apiRequest(`/driver-loads/${id}`, { method: 'DELETE' }, token),
  saveItems: (id: string, items: any[], token?: string) =>
    apiRequest(`/driver-loads/${id}/items`, { method: 'POST', body: JSON.stringify({ items }) }, token),
};

// QC Pallet APIs (perforating gun inspection)
export const qcPalletApi = {
  getAll: (token?: string) => apiRequest('/qc-pallets', {}, token),
  getPassed: (token?: string) => apiRequest('/qc-pallets/passed', {}, token),
  // QC-passed / no-QC pallets that are NOT yet on any driver load (ready to load).
  getReady: (token?: string) => apiRequest('/qc-pallets/ready', {}, token),
  get: (id: string, token?: string) => apiRequest(`/qc-pallets/${id}`, {}, token),
  create: (pallet: any, token?: string) =>
    apiRequest('/qc-pallets', { method: 'POST', body: JSON.stringify(pallet) }, token),
  update: (id: string, updates: any, token?: string) =>
    apiRequest(`/qc-pallets/${id}`, { method: 'PUT', body: JSON.stringify(updates) }, token),
  remove: (id: string, token?: string) =>
    apiRequest(`/qc-pallets/${id}`, { method: 'DELETE' }, token),
  // sampleSize = number of guns to inspect; gunsInPallet = total lot size (optional, for record).
  initGuns: (id: string, sampleSize: number, gunsInPallet?: number, token?: string) =>
    apiRequest(`/qc-pallets/${id}/guns`, {
      method: 'POST',
      body: JSON.stringify({ sample_size: sampleSize, guns_in_pallet: gunsInPallet }),
    }, token),
  // Suggested AQL Level II sample size for a given lot total.
  aql: (lot: number, token?: string) =>
    apiRequest(`/qc-aql?lot=${encodeURIComponent(lot)}`, {}, token),
  // Parse extracted slip text -> structured header fields (no DB writes).
  parseSlip: (text: string, token?: string) =>
    apiRequest('/qc-slip/parse', { method: 'POST', body: JSON.stringify({ text }) }, token),
  // Create one pallet per fulfillment id from a parsed slip header.
  createFromSlip: (payload: any, token?: string) =>
    apiRequest('/qc-pallets/from-slip', { method: 'POST', body: JSON.stringify(payload) }, token),
  saveGun: (gunId: string, payload: any, token?: string) =>
    apiRequest(`/qc-guns/${gunId}`, { method: 'PUT', body: JSON.stringify(payload) }, token),
  signoff: (id: string, signedOffBy: string, token?: string) =>
    apiRequest(`/qc-pallets/${id}/signoff`, { method: 'POST', body: JSON.stringify({ signed_off_by: signedOffBy }) }, token),
};

// ── QC pallet file/image helpers (polymorphic images table) ────────────────────
// These talk to POST/GET/DELETE /images/:parentTable/:parentRowId. We do NOT use
// apiRequest for upload because it forces Content-Type: application/json, which
// would break the multipart FormData boundary.
async function authHeader(token?: string): Promise<string> {
  let t = token;
  if (!t) {
    try {
      const { data } = await supabase.auth.getSession();
      t = data.session?.access_token;
    } catch {
      // ignore
    }
  }
  return `Bearer ${t || publicAnonKey}`;
}

export const qcPalletFileApi = {
  // List all images/files attached to a pallet (any field_name).
  list: (palletId: string, token?: string) =>
    apiRequest(`/images/qc_pallets/${encodeURIComponent(palletId)}`, {}, token),

  // Upload a file (PDF or image) tagged with a field_name. Returns { id, url, storagePath }.
  upload: async (palletId: string, file: File, fieldName: string, token?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('fieldName', fieldName);
    const resp = await fetch(
      `${API_BASE_URL}/images/qc_pallets/${encodeURIComponent(palletId)}`,
      { method: 'POST', headers: { Authorization: await authHeader(token) }, body: fd },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Upload failed (HTTP ${resp.status})`);
    }
    return resp.json();
  },

  remove: (imageId: string, token?: string) =>
    apiRequest(`/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' }, token),
};

// ── Driver-load file/image helpers (polymorphic images table) ──────────────────
// Mirrors qcPalletFileApi but targets the driver_loads parent. Used by the
// packing-slip PDF auto-import flow to attach the parsed PDF to its SO group.
export const driverLoadFileApi = {
  list: (loadId: string, token?: string) =>
    apiRequest(`/images/driver_loads/${encodeURIComponent(loadId)}`, {}, token),

  upload: async (loadId: string, file: File, fieldName: string, token?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('fieldName', fieldName);
    const resp = await fetch(
      `${API_BASE_URL}/images/driver_loads/${encodeURIComponent(loadId)}`,
      { method: 'POST', headers: { Authorization: await authHeader(token) }, body: fd },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Upload failed (HTTP ${resp.status})`);
    }
    return resp.json();
  },

  remove: (imageId: string, token?: string) =>
    apiRequest(`/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' }, token),
};

// Auth APIs
export const authApi = {
  signup: (userData: { email: string; password: string; name: string; role: string }) => 
    apiRequest('/signup', { method: 'POST', body: JSON.stringify(userData) }),
};

// Detail APIs with KPIs
export const detailApi = {
  getFieldVisit: (id: string, token?: string) => apiRequest(`/field-visits/${id}`, {}, token),
  getIncident: (id: string, token?: string) => apiRequest(`/incidents/${id}`, {}, token),
  getPanel: (id: string, token?: string) => apiRequest(`/panels/${id}`, {}, token),
  getCustomer: (id: string, token?: string) => apiRequest(`/customers/${id}/details`, {}, token),
  getDistrict: (id: string, token?: string) => apiRequest(`/districts/${id}/details`, {}, token),
};