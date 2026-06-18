import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2.49.2";
import { uploadIncidentImage, listIncidentImages, deleteIncidentImage, uploadImage, listImagesForRecord, deleteImageById } from './upload-handler.tsx';
import { generateIncidentReportPDF } from './pdf-generator.tsx';
import { requireAdmin, requireUser } from './auth-helpers.tsx';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: { schema: 'fst_app' }
  }
);

export const apiRoutes = new Hono();

// SECURITY: every route in this router runs against the SERVICE_ROLE client,
// which bypasses RLS. We therefore require a real signed-in user on ALL
// routes (reads + writes). Delete routes additionally enforce requireAdmin.
// Without this, anyone holding the public anon key could read/write all data
// through the edge function, defeating the table RLS policies entirely.
//
// NOTE: this router is mounted at the same base path as the public auth
// routes (signin/signup/session/admin-exists/health/config/signout) defined
// in index.tsx. Hono applies a mounted sub-app's wildcard middleware to the
// whole shared prefix, so a blanket use('*') would (wrongly) guard those
// public routes too and lock users out at login. We therefore exempt the
// known public paths explicitly.
const PUBLIC_PATHS = new Set([
  '/make-server-64775d98/signin',
  '/make-server-64775d98/signup',
  '/make-server-64775d98/signout',
  '/make-server-64775d98/session',
  '/make-server-64775d98/admin-exists',
  '/make-server-64775d98/health',
  '/make-server-64775d98/config',
  '/make-server-64775d98/schema',
  '/make-server-64775d98/diagnose-row-id',
]);
apiRoutes.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || PUBLIC_PATHS.has(new URL(c.req.url).pathname)) {
    return next();
  }
  return requireUser(c, next);
});

/**
 * Coerce any inbound action_status value to one of the three literals
 * allowed by the `incidents_action_status_check` Postgres CHECK constraint:
 *   ('Open', 'In Progress', 'Complete')
 * Returns null for empty / unknown so the column is left null rather than
 * triggering a constraint violation. NOTE: 'Complete', NOT 'Completed'.
 */
function normalizeActionStatusForDb(raw: unknown): 'Open' | 'In Progress' | 'Complete' | null {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower === 'complete' || lower === 'completed' || lower === 'done' || lower === 'closed') return 'Complete';
  if (lower === 'open') return 'Open';
  if (lower === 'in progress' || lower === 'in-progress' || lower === 'inprogress' || lower === 'pending') return 'In Progress';
  return null;
}

// ============ CUSTOMERS ============

apiRoutes.get("/customers", async (c) => {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('customer');

    if (error) {
      console.error('Error fetching customers:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data || []);
  } catch (error) {
    console.error('Error in customers endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.post("/customers", async (c) => {
  try {
    const body = await c.req.json();
    
    const { data, error } = await supabase
      .from('customers')
      .insert({
        customer: body.customer,
        customer_logo: body.customer_logo || null
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating customer:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in create customer endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.put("/customers/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    
    const { data, error } = await supabase
      .from('customers')
      .update({
        customer: body.customer,
        customer_logo: body.customer_logo
      })
      .eq('row_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating customer:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in update customer endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.delete("/customers/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('row_id', id);

    if (error) {
      console.error('Error deleting customer:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error in delete customer endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ DISTRICTS ============

apiRoutes.get("/districts", async (c) => {
  try {
    const { data, error } = await supabase
      .from('districts')
      .select('*')
      .order('customer_district');

    if (error) {
      console.error('Error fetching districts:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data || []);
  } catch (error) {
    console.error('Error in districts endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get districts by customer
apiRoutes.get("/districts/:customerId", async (c) => {
  try {
    const customerId = c.req.param('customerId');
    
    const { data, error } = await supabase
      .from('districts')
      .select('*')
      .eq('customer', customerId)
      .order('customer_district');

    if (error) {
      console.error('Error fetching districts by customer:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data || []);
  } catch (error) {
    console.error('Error in districts by customer endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.post("/districts", async (c) => {
  try {
    const body = await c.req.json();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Log the request body for debugging
    console.log('Creating district with data:', JSON.stringify(body, null, 2));

    // Validate required fields
    const districtId = typeof body.customer_district_id === 'string' ? body.customer_district_id.trim() : '';
    const districtName = typeof body.customer_district === 'string' ? body.customer_district.trim() : '';
    const customerId = body.customer;

    if (!districtId || !districtName || !customerId) {
      console.error('Validation failed:', { districtId, districtName, customerId });
      return c.json({ 
        error: 'Missing required fields: customer_district_id, customer_district, and customer are required',
        received: { 
          customer_district_id: districtId || '(empty)',
          customer_district: districtName || '(empty)',
          customer: customerId || '(empty)'
        }
      }, 400);
    }

    // Get customer name for denormalization
    const { data: customer } = await supabase
      .from('customers')
      .select('customer, customer_logo')
      .eq('row_id', customerId)
      .single();
    
    const { data, error } = await supabase
      .from('districts')
      .insert({
        customer_district_id: districtId,
        customer_district: districtName,
        customer_address: typeof body.customer_address === 'string' ? body.customer_address.trim() || null : null,
        district_contact: typeof body.district_contact === 'string' ? body.district_contact.trim() || null : null,
        customer_email: typeof body.customer_email === 'string' ? body.customer_email.trim() || null : null,
        customer_phone_number: typeof body.customer_phone_number === 'string' ? body.customer_phone_number.trim() || null : null,
        customer: customerId,
        customer_name: customer?.customer || null,
        customer_logo: customer?.customer_logo || null
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating district:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in create district endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.put("/districts/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    
    // Validate required fields (check for null, undefined, or empty strings after trimming)
    if (!body.customer_district_id?.trim() || !body.customer_district?.trim() || !body.customer) {
      return c.json({ error: 'Missing required fields: customer_district_id, customer_district, and customer are required' }, 400);
    }
    
    // Get customer name for denormalization
    const { data: customer } = await supabase
      .from('customers')
      .select('customer, customer_logo')
      .eq('row_id', body.customer)
      .single();
    
    const { data, error } = await supabase
      .from('districts')
      .update({
        customer_district_id: body.customer_district_id.trim(),
        customer_district: body.customer_district.trim(),
        customer_address: body.customer_address?.trim() || null,
        district_contact: body.district_contact?.trim() || null,
        customer_email: body.customer_email?.trim() || null,
        customer_phone_number: body.customer_phone_number?.trim() || null,
        customer: body.customer,
        customer_name: customer?.customer || null,
        customer_logo: customer?.customer_logo || null
      })
      .eq('row_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating district:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in update district endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.delete("/districts/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    
    const { error } = await supabase
      .from('districts')
      .delete()
      .eq('row_id', id);

    if (error) {
      console.error('Error deleting district:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error in delete district endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ FIELD VISITS ============

const listFieldVisits = async (c: any) => {
  try {
    // Fetch ALL field visits with range-based pagination to defeat the
    // PostgREST default 1000-row cap. A single .select() silently truncates
    // at 1000 rows, which previously capped every dashboard metric/chart.
    const step = 1000;
    let from = 0;
    const allVisits: any[] = [];
    while (true) {
      const { data, error } = await supabase
        .from('fieldvisits')
        .select('*')
        .order('arrival_date', { ascending: false })
        .range(from, from + step - 1);

      if (error) {
        console.error('Error fetching field visits:', error);
        return c.json({ error: error.message }, 500);
      }

      const batch = data || [];
      allVisits.push(...batch);
      if (batch.length < step) break; // last page
      from += step;
    }

    // Batch-fetch customer + district names once (avoids N+1 per-row queries
    // that would be very slow now that we return the full dataset).
    const customerIds = Array.from(
      new Set(allVisits.map((v) => v.customer).filter((id) => id != null))
    );
    const districtIds = Array.from(
      new Set(allVisits.map((v) => v.customer_district).filter((id) => id != null))
    );

    const customerNameById: Record<string, string | null> = {};
    const districtNameById: Record<string, string | null> = {};

    // Fetch in chunks to avoid overly long IN() lists.
    const chunk = (arr: any[], size: number): any[][] => {
      const out: any[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    for (const ids of chunk(customerIds, 200)) {
      if (ids.length === 0) continue;
      const { data: rows } = await supabase
        .from('customers')
        .select('row_id, customer')
        .in('row_id', ids);
      for (const r of rows || []) customerNameById[r.row_id] = r.customer ?? null;
    }

    for (const ids of chunk(districtIds, 200)) {
      if (ids.length === 0) continue;
      const { data: rows } = await supabase
        .from('districts')
        .select('row_id, customer_district')
        .in('row_id', ids);
      for (const r of rows || []) districtNameById[r.row_id] = r.customer_district ?? null;
    }

    const enrichedData = allVisits.map((visit) => ({
      ...visit,
      customerName: visit.customer != null ? (customerNameById[visit.customer] ?? null) : null,
      districtName: visit.customer_district != null ? (districtNameById[visit.customer_district] ?? null) : null,
    }));

    return c.json(enrichedData);
  } catch (error) {
    console.error('Error in field visits endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
};
apiRoutes.get("/fieldvisits", listFieldVisits);
apiRoutes.get("/field-visits", listFieldVisits);

// Shared helper: when a field visit records which panels were seen, stamp each
// of those panels as verified='Y' plus a last-seen audit trail (date / by /
// visit). Best-effort: a stamping failure is logged but never blocks the visit
// save. Serials are matched against panels.serial_number.
const stampPanelsSeen = async (
  serials: any,
  opts: { seenDate?: string | null; seenBy?: string | null; visitId?: string | null }
) => {
  try {
    const list = Array.isArray(serials)
      ? serials.map((s: any) => (s == null ? '' : String(s).trim())).filter((s: string) => s !== '')
      : [];
    if (list.length === 0) return;
    const uniq = Array.from(new Set(list));
    const stampDate = opts.seenDate || new Date().toISOString();
    const { error } = await supabase
      .from('panels')
      .update({
        verified: 'Y',
        last_seen_date: stampDate,
        last_seen_by: opts.seenBy ?? null,
        last_seen_visit_id: opts.visitId ?? null
      })
      .in('serial_number', uniq);
    if (error) {
      console.error('Error stamping panels seen:', error);
    }
  } catch (err) {
    console.error('Exception stamping panels seen:', err);
  }
};

const createFieldVisit = async (c: any) => {
  try {
    const body = await c.req.json();
    
    const { data, error } = await supabase
      .from('fieldvisits')
      .insert({
        field_visit_id: body.field_visit_id,
        arrival_date: body.arrival_date,
        departure_date: body.departure_date,
        visit_purpose: body.visit_purpose,
        field_or_facility: body.field_or_facility,
        visit_summary: body.visit_summary,
        lat_long: body.lat_long,
        customer_rep: body.customer_rep,
        pad_name: body.pad_name,
        visit_duration: body.visit_duration,
        operating_company: body.operating_company,
        customer: body.customer,
        customer_district: body.customer_district,
        communication_panel: body.communication_panel,
        digital_shooting_panel: body.digital_shooting_panel,
        surface_tester: body.surface_tester,
        panels_seen: body.panels_seen,
        xc_rep: body.xc_rep
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating field visit:', error);
      return c.json({ error: error.message }, 500);
    }

    // Mark every panel listed on this visit as seen (verified + last-seen stamp).
    await stampPanelsSeen(body.panels_seen, {
      seenDate: body.arrival_date,
      seenBy: body.xc_rep,
      visitId: body.field_visit_id
    });

    return c.json(data);
  } catch (error) {
    console.error('Error in create field visit endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
};
apiRoutes.post("/fieldvisits", createFieldVisit);
apiRoutes.post("/field-visits", createFieldVisit);

// Shared handler for updating a field visit. Registered under both
// '/fieldvisits/:id' and the hyphenated '/field-visits/:id' (the client calls
// the hyphenated path — the no-hyphen-only route previously 404'd edits).
const updateFieldVisit = async (c: any) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    
    const { data, error } = await supabase
      .from('fieldvisits')
      .update({
        field_visit_id: body.field_visit_id,
        arrival_date: body.arrival_date,
        departure_date: body.departure_date,
        visit_purpose: body.visit_purpose,
        field_or_facility: body.field_or_facility,
        visit_summary: body.visit_summary,
        lat_long: body.lat_long,
        customer_rep: body.customer_rep,
        pad_name: body.pad_name,
        visit_duration: body.visit_duration,
        operating_company: body.operating_company,
        customer: body.customer,
        customer_district: body.customer_district,
        communication_panel: body.communication_panel,
        digital_shooting_panel: body.digital_shooting_panel,
        surface_tester: body.surface_tester,
        panels_seen: body.panels_seen,
        xc_rep: body.xc_rep,
        // Completion workflow + audit stamps.
        visit_status: body.visit_status,
        completed_at: body.completed_at,
        completed_by: body.completed_by,
        updated_by: body.updated_by,
        date_updated: body.date_updated
      })
      .eq('row_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating field visit:', error);
      return c.json({ error: error.message }, 500);
    }

    // Mark every panel listed on this visit as seen (verified + last-seen stamp).
    await stampPanelsSeen(body.panels_seen, {
      seenDate: body.arrival_date,
      seenBy: body.xc_rep,
      visitId: body.field_visit_id
    });

    return c.json(data);
  } catch (error) {
    console.error('Error in update field visit endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
};
apiRoutes.put("/fieldvisits/:id", updateFieldVisit);
apiRoutes.put("/field-visits/:id", updateFieldVisit);

apiRoutes.delete("/fieldvisits/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    
    const { error } = await supabase
      .from('fieldvisits')
      .delete()
      .eq('row_id', id);

    if (error) {
      console.error('Error deleting field visit:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error in delete field visit endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ INCIDENTS ============

apiRoutes.get("/incidents", async (c) => {
  try {
    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .order('date_incident', { ascending: false });

    if (error) {
      console.error('Error fetching incidents:', error);
      return c.json({ error: error.message }, 500);
    }

    // Enrich with customer and district names
    const enrichedData = await Promise.all((data || []).map(async (incident) => {
      let customerName = null;
      let districtName = null;

      if (incident.customer) {
        const { data: customer } = await supabase
          .from('customers')
          .select('customer')
          .eq('row_id', incident.customer)
          .single();
        customerName = customer?.customer;
      }

      if (incident.customer_district) {
        const { data: district } = await supabase
          .from('districts')
          .select('customer_district')
          .eq('row_id', incident.customer_district)
          .single();
        districtName = district?.customer_district;
      }

      return {
        ...incident,
        customerName,
        districtName
      };
    }));

    return c.json(enrichedData);
  } catch (error) {
    console.error('Error in incidents endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.post("/incidents", async (c) => {
  try {
    const body = await c.req.json();
    
    // Generate a unique row_id using nanoid (if row_id needs to be manually set)
    // Note: Ideally row_id should be auto-generated by the database with a DEFAULT value
    const { data, error } = await supabase
      .from('incidents')
      .insert({
        event_id: body.event_id,
        date_incident: body.date_incident,
        incident_status: body.incident_status,
        incident_severity: body.incident_severity,
        field_facility: body.field_facility,
        notes: body.notes,
        customer_rep: body.customer_rep,
        ep_rep: body.ep_rep,
        well_name: body.well_name,
        'stage#': body['stage#'],
        xc_district: body.xc_district,
        product_line: body.product_line,
        firing_system: body.firing_system,
        xc_caused: body.xc_caused,
        event_category: body.event_category,
        vendor_caused: body.vendor_caused,
        'so#': body['so#'],
        incident_description: body.incident_description,
        investigation: body.investigation,
        root_cause: body.root_cause,
        image1: body.image1,
        image2: body.image2,
        incident_report: body.incident_report,
        report_sent: body.report_sent,
        customer_district: body.customer_district,
        field_visit_id: body.field_visit_id,
        qc_pallet_id: body.qc_pallet_id,
        qc_build_no: body.qc_build_no,
        xc_rep: body.xc_rep,
        operating_company: body.operating_company,
        vendor: body.vendor,
        failed_component: body.failed_component,
        customer: body.customer,
        failure_type: body.failure_type,
        corrective_action: body.corrective_action,
        preventive_action: body.preventive_action,
        action_assigned_to: body.action_assigned_to,
        action_due_date: body.action_due_date,
        action_status: normalizeActionStatusForDb(body.action_status),
        closed_date: body.closed_date,
        closed_by: body.closed_by,
        report_version: body.report_version,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating incident:', error);
      
      // Provide more helpful error messages for common issues
      let errorMessage = error.message;
      if (error.code === '23503') {
        errorMessage = `Foreign key constraint error: The value you entered for "${error.details?.match(/Key \((.+?)\)=/)?.[1] || 'a field'}" doesn't exist in the reference table. Please check your database schema or enter a different value.`;
      } else if (error.code === '23505') {
        errorMessage = `Duplicate entry: This ${error.details?.match(/Key \((.+?)\)=/)?.[1] || 'value'} already exists.`;
      } else if (error.code === '23502') {
        errorMessage = `Missing required field: ${error.details?.match(/column "(.+?)"/)?.[1] || 'A required field is missing'}.`;
      }
      
      return c.json({ 
        error: errorMessage,
        code: error.code,
        details: error.details,
        hint: error.hint 
      }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in create incident endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.put("/incidents/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    
    const { data, error } = await supabase
      .from('incidents')
      .update({
        event_id: body.event_id,
        date_incident: body.date_incident,
        incident_status: body.incident_status,
        incident_severity: body.incident_severity,
        field_facility: body.field_facility,
        notes: body.notes,
        customer_rep: body.customer_rep,
        ep_rep: body.ep_rep,
        well_name: body.well_name,
        'stage#': body['stage#'],
        xc_district: body.xc_district,
        product_line: body.product_line,
        firing_system: body.firing_system,
        xc_caused: body.xc_caused,
        event_category: body.event_category,
        vendor_caused: body.vendor_caused,
        'so#': body['so#'],
        incident_description: body.incident_description,
        investigation: body.investigation,
        root_cause: body.root_cause,
        image1: body.image1,
        image2: body.image2,
        incident_report: body.incident_report,
        report_sent: body.report_sent,
        customer_district: body.customer_district,
        field_visit_id: body.field_visit_id,
        qc_pallet_id: body.qc_pallet_id,
        qc_build_no: body.qc_build_no,
        xc_rep: body.xc_rep,
        operating_company: body.operating_company,
        vendor: body.vendor,
        failed_component: body.failed_component,
        customer: body.customer,
        failure_type: body.failure_type,
        corrective_action: body.corrective_action,
        preventive_action: body.preventive_action,
        action_assigned_to: body.action_assigned_to,
        action_due_date: body.action_due_date,
        action_status: normalizeActionStatusForDb(body.action_status),
        closed_date: body.closed_date,
        closed_by: body.closed_by,
        report_version: body.report_version,
      })
      .eq('row_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating incident:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in update incident endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.delete("/incidents/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    
    const { error } = await supabase
      .from('incidents')
      .delete()
      .eq('row_id', id);

    if (error) {
      console.error('Error deleting incident:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error in delete incident endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ PANELS ============

// ============ SALES (using stages and barrels_sold tables) ============

apiRoutes.get("/sales", async (c) => {
  try {
    // PostgREST caps a single select at 1000 rows; sales_volume has >1000 rows per
    // metric_type, so page through with .range() to fetch ALL rows (else totals are short).
    const fetchAllByMetric = async (metric: string) => {
      const PAGE = 1000;
      let from = 0;
      const all: any[] = [];
      while (true) {
        const { data, error } = await supabase
          .from('sales_volume')
          .select('*')
          .eq('metric_type', metric)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data || [];
        all.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
      }
      return all;
    };

    let barrelsData: any[];
    let stagesData: any[];
    try {
      barrelsData = await fetchAllByMetric('barrels');
      stagesData = await fetchAllByMetric('stages');
    } catch (err: any) {
      console.error('Error fetching sales_volume:', err);
      return c.json({ error: err?.message || String(err) }, 500);
    }

    // Combine data by date and customer/district
    const combinedMap = new Map();

    // Process barrels data — SUM (not overwrite) when multiple rows share a date+customer+district key
    (barrelsData || []).forEach(barrel => {
      const key = `${barrel.date}-${barrel.customer}-${barrel.customer_district}`;
      const qty = Number(barrel.quantity) || 0;
      if (!combinedMap.has(key)) {
        combinedMap.set(key, {
          id: barrel.row_id,
          weekEnding: barrel.date,
          customer: barrel.customer,
          customerId: barrel.customer,
          customerName: barrel.customer,
          districtId: barrel.customer_district,
          districtName: barrel.customer_district,
          barrels: qty,
          stages: 0,
          notes: null,
          enteredBy: null
        });
      } else {
        const existing = combinedMap.get(key);
        existing.barrels += qty;
      }
    });

    // Process stages data — SUM (not overwrite) when multiple rows share a date+customer+district key
    (stagesData || []).forEach(stage => {
      const key = `${stage.date}-${stage.customer}-${stage.customer_district}`;
      const qty = Number(stage.quantity) || 0;
      if (!combinedMap.has(key)) {
        combinedMap.set(key, {
          id: stage.row_id,
          weekEnding: stage.date,
          customer: stage.customer,
          customerId: stage.customer,
          customerName: stage.customer,
          districtId: stage.customer_district,
          districtName: stage.customer_district,
          barrels: 0,
          stages: qty,
          notes: null,
          enteredBy: null
        });
      } else {
        const existing = combinedMap.get(key);
        existing.stages += qty;
      }
    });

    // Convert map to array and sort by date descending
    const combinedData = Array.from(combinedMap.values()).sort((a, b) => {
      return new Date(b.weekEnding).getTime() - new Date(a.weekEnding).getTime();
    });

    // Ensure unique IDs for each record
    const dataWithUniqueIds = combinedData.map((record, index) => ({
      ...record,
      id: `${record.weekEnding}-${record.customer}-${record.districtId}-${index}`
    }));

    return c.json(dataWithUniqueIds);
  } catch (error) {
    console.error('Error in sales endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.post("/sales", async (c) => {
  try {
    const body = await c.req.json();
    
    // Get customer and district names for foreign keys
    const { data: customer } = await supabase
      .from('customers')
      .select('customer')
      .eq('row_id', body.customer)
      .single();
    
    const { data: district } = await supabase
      .from('districts')
      .select('customer_district')
      .eq('row_id', body.customer_district)
      .single();
    
    const customerName = customer?.customer;
    const districtName = district?.customer_district;
    
    // Insert barrels row into sales_volume if barrels > 0
    if (body.barrels && body.barrels > 0) {
      const { error: barrelsError } = await supabase
        .from('sales_volume')
        .insert({
          metric_type: 'barrels',
          date_text: body.weekEnding,
          date: body.weekEnding,
          quantity: body.barrels.toString(),
          customer_district: districtName,
          customer: customerName,
          category: 'Perforating Guns'
        });

      if (barrelsError) {
        console.error('Error creating barrels record:', barrelsError);
        return c.json({ error: barrelsError.message }, 500);
      }
    }

    // Insert stages row into sales_volume if stages > 0
    if (body.stages && body.stages > 0) {
      const { error: stagesError } = await supabase
        .from('sales_volume')
        .insert({
          metric_type: 'stages',
          date_text: body.weekEnding,
          date: body.weekEnding,
          quantity: body.stages.toString(),
          customer_district: districtName,
          customer: customerName,
          category: 'Stage'
        });

      if (stagesError) {
        console.error('Error creating stages record:', stagesError);
        return c.json({ error: stagesError.message }, 500);
      }
    }

    return c.json({ 
      success: true,
      message: 'Sales data recorded successfully'
    });
  } catch (error) {
    console.error('Error in create sale endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ FIRMWARE TARGETS ============
// Target (current/latest) firmware versions the fleet should be running.
// Stored as a single JSONB blob in the kv store under key 'firmware_targets'.
// Shape: { gui_version, wl_controlfw, surfacefw, shootingfw, loggingfw, updated_at, updated_by }
const FW_TARGETS_KEY = 'firmware_targets';
const FW_TARGET_FIELDS = ['gui_version', 'wl_controlfw', 'surfacefw', 'shootingfw', 'loggingfw'] as const;

apiRoutes.get("/firmware-targets", async (c) => {
  try {
    const { data, error } = await supabase
      .from('kv_store_64775d98')
      .select('value')
      .eq('key', FW_TARGETS_KEY)
      .maybeSingle();
    if (error) {
      console.error('Error fetching firmware targets:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json(data?.value ?? {});
  } catch (error) {
    console.error('Error in firmware-targets GET:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// NOTE: Admin gating for this route is enforced in the UI (the "Set targets"
// control is only shown to admins), consistent with the rest of this app's
// admin actions (e.g. Import) which send the anon key rather than a user JWT.
// If/when the app moves to server-enforced admin auth, wrap this in
// requireAdmin and switch the frontend to send a real Supabase JWT.
apiRoutes.put("/firmware-targets", async (c) => {
  try {
    const body = await c.req.json();
    const value: Record<string, unknown> = {};
    for (const f of FW_TARGET_FIELDS) {
      const v = body?.[f];
      value[f] = (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim();
    }
    value.updated_at = new Date().toISOString();
    value.updated_by = body?.updated_by ?? null;
    const { error } = await supabase
      .from('kv_store_64775d98')
      .upsert({ key: FW_TARGETS_KEY, value });
    if (error) {
      console.error('Error saving firmware targets:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json(value);
  } catch (error) {
    console.error('Error in firmware-targets PUT:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ PANELS ============

apiRoutes.get("/panels", async (c) => {
  try {
    const { data, error } = await supabase
      .from('panels')
      .select('*')
      .order('date_updated', { ascending: false });

    if (error) {
      console.error('Error fetching panels:', error);
      return c.json({ error: error.message }, 500);
    }

    // Enrich with customer and district names
    const enrichedData = await Promise.all((data || []).map(async (panel) => {
      let customerName = null;
      let districtName = null;

      if (panel.customer) {
        const { data: customer } = await supabase
          .from('customers')
          .select('customer')
          .eq('row_id', panel.customer)
          .single();
        customerName = customer?.customer;
      }

      if (panel.customer_district) {
        const { data: district } = await supabase
          .from('districts')
          .select('customer_district')
          .eq('row_id', panel.customer_district)
          .single();
        districtName = district?.customer_district;
      }

      return {
        ...panel,
        customerName,
        districtName
      };
    }));

    return c.json(enrichedData);
  } catch (error) {
    console.error('Error in panels endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.post("/panels", async (c) => {
  try {
    const body = await c.req.json();
    
    const { data, error } = await supabase
      .from('panels')
      .insert({
        panel_type: body.panel_type,
        plus_panel: body.plus_panel,
        serial_number: body.serial_number,
        shootingfw: body.shootingfw,
        wl_controlfw: body.wl_controlfw,
        loggingfw: body.loggingfw,
        gui_version: body.gui_version,
        surfacefw: body.surfacefw,
        received_date: body.received_date,
        xc_base: body.xc_base,
        panel_status: body.panel_status,
        unit_number: body.unit_number,
        'so#': body['so#'],
        date_updated: body.date_updated,
        tracking_info: body.tracking_info,
        comments: body.comments,
        verified: body.verified,
        rma: body.rma,
        is_spare: body.is_spare,
        customer_district: body.customer_district,
        operating_company: body.operating_company,
        customer: body.customer,
        updated_by: body.updated_by,
        activity: body.activity
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating panel:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in create panel endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.put("/panels/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    
    const { data, error } = await supabase
      .from('panels')
      .update({
        panel_type: body.panel_type,
        plus_panel: body.plus_panel,
        serial_number: body.serial_number,
        shootingfw: body.shootingfw,
        wl_controlfw: body.wl_controlfw,
        loggingfw: body.loggingfw,
        gui_version: body.gui_version,
        surfacefw: body.surfacefw,
        received_date: body.received_date,
        xc_base: body.xc_base,
        panel_status: body.panel_status,
        unit_number: body.unit_number,
        'so#': body['so#'],
        date_updated: body.date_updated,
        tracking_info: body.tracking_info,
        comments: body.comments,
        verified: body.verified,
        rma: body.rma,
        is_spare: body.is_spare,
        customer_district: body.customer_district,
        operating_company: body.operating_company,
        customer: body.customer,
        updated_by: body.updated_by,
        activity: body.activity,
        // Return workflow: when a leased/loaned/in-repair panel comes back to a
        // XC facility. returned_date set => panel_status auto-flipped to
        // 'At Facility' on the client (see PanelDetail handleMarkReturned).
        returned_date: body.returned_date,
        return_notes: body.return_notes,
        return_confirmed_by: body.return_confirmed_by
      })
      .eq('row_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating panel:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in update panel endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Dedicated per-panel "Mark Seen" action. Sets verified='Y' and stamps the
// last-seen audit trail without requiring a full field visit. Matched by row_id.
// Body: { seen_by?, seen_date?, visit_id? }
apiRoutes.post("/panels/:id/mark-seen", async (c) => {
  try {
    const id = c.req.param('id');
    let body: any = {};
    try { body = await c.req.json(); } catch (_) { body = {}; }

    const { data, error } = await supabase
      .from('panels')
      .update({
        verified: 'Y',
        last_seen_date: body.seen_date || new Date().toISOString(),
        last_seen_by: body.seen_by ?? null,
        last_seen_visit_id: body.visit_id ?? null
      })
      .eq('row_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error marking panel seen:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in mark panel seen endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.delete("/panels/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    
    const { error } = await supabase
      .from('panels')
      .delete()
      .eq('row_id', id);

    if (error) {
      console.error('Error deleting panel:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error in delete panel endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ DRIVER LOADS (hotshot checklist) ============

// Whitelist of columns writable from the client, to avoid mass-assignment.
const DRIVER_LOAD_FIELDS = [
  'load_number','delivery_date','origin_district','customer','customer_district',
  'destination','packing_slip_no','packing_slips_by_so','mode_of_delivery','trailer_connected','driver_type',
  'driver','driver_name','driver_company','hazmat_load','hardware_present',
  'ancillary_explosives','explosive_types','document_correlation','items_secure',
  'driver_sig_url','inspector_name','inspector_sig_url','manager_name','manager_sig_url',
  'status','departed_by','departed_at','notes','updated_by',
];
function pickDriverLoad(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of DRIVER_LOAD_FIELDS) if (k in body) out[k] = body[k];
  return out;
}

// List loads. Admins see all; non-admins see only their own (by driver email).
apiRoutes.get("/driver-loads", async (c) => {
  try {
    const user = c.get('user');
    let q = supabase.from('driver_loads').select('*').order('created_at', { ascending: false });
    if (user?.role !== 'admin' && user?.email) {
      q = q.eq('driver', user.email);
    }
    const { data, error } = await q;
    if (error) {
      console.error('Error fetching driver loads:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json(data || []);
  } catch (error) {
    console.error('Error in driver-loads list endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Detail: a load + its items.
apiRoutes.get("/driver-loads/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const { data: load, error } = await supabase
      .from('driver_loads').select('*').eq('row_id', id).single();
    if (error) {
      console.error('Error fetching driver load:', error);
      return c.json({ error: error.message }, 500);
    }
    const { data: items } = await supabase
      .from('driver_load_items').select('*').eq('load_row_id', id).order('created_at');
    return c.json({ ...load, items: items || [] });
  } catch (error) {
    console.error('Error in driver-load detail endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.post("/driver-loads", async (c) => {
  try {
    const body = await c.req.json();
    const { data, error } = await supabase
      .from('driver_loads').insert(pickDriverLoad(body)).select().single();
    if (error) {
      console.error('Error creating driver load:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json(data);
  } catch (error) {
    console.error('Error in create driver load endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.put("/driver-loads/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const patch = pickDriverLoad(body);
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('driver_loads').update(patch).eq('row_id', id).select().single();
    if (error) {
      console.error('Error updating driver load:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json(data);
  } catch (error) {
    console.error('Error in update driver load endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.delete("/driver-loads/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const { error } = await supabase.from('driver_loads').delete().eq('row_id', id);
    if (error) {
      console.error('Error deleting driver load:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json({ success: true });
  } catch (error) {
    console.error('Error in delete driver load endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Replace the full set of line items for a load (simplest reliable sync).
apiRoutes.post("/driver-loads/:id/items", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    // Wipe and re-insert.
    const { error: delErr } = await supabase
      .from('driver_load_items').delete().eq('load_row_id', id);
    if (delErr) {
      console.error('Error clearing driver load items:', delErr);
      return c.json({ error: delErr.message }, 500);
    }
    if (items.length) {
      const rows = items.map((it: Record<string, unknown>) => ({
        load_row_id: id,
        pallet_build_no: it.pallet_build_no ?? null,
        description: it.description ?? null,
        qty_expected: it.qty_expected ?? 0,
        qty_loaded: it.qty_loaded ?? 0,
        destination: it.destination ?? null,
        load_type: it.load_type ?? null,
        checked: it.checked ?? false,
        note: it.note ?? null,
        source_pallet_row_id: it.source_pallet_row_id ?? null,
      }));
      const { error: insErr } = await supabase.from('driver_load_items').insert(rows);
      if (insErr) {
        console.error('Error inserting driver load items:', insErr);
        return c.json({ error: insErr.message }, 500);
      }
    }
    const { data: saved } = await supabase
      .from('driver_load_items').select('*').eq('load_row_id', id).order('created_at');
    return c.json({ items: saved || [] });
  } catch (error) {
    console.error('Error in driver-load items endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ QC PALLETS (perforating gun inspection) ============

// A single pallet can physically hold at most this many perforating guns.
// Build slips report the true per-pallet count (<= this); packing slips report
// the whole-order total across all fulfillments, which is NOT a per-pallet lot.
const MAX_GUNS_PER_PALLET = 100;
// Clamp any per-pallet gun lot to [1, MAX]; null/0/invalid -> null.
function clampGunsInPallet(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), MAX_GUNS_PER_PALLET);
}

const QC_PALLET_FIELDS = [
  'build_no','customer','destination','load_type','guns_total',
  'guns_in_pallet','sample_size',
  'sales_order','fulfillment_id','operator',
  'status','signed_off_by','signed_off_at','notes','updated_by',
  'requires_qc','item_category',
];
function pickQcPallet(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of QC_PALLET_FIELDS) if (k in body) out[k] = body[k];
  // Enforce the per-pallet gun cap regardless of client input.
  if ('guns_in_pallet' in out) out.guns_in_pallet = clampGunsInPallet(out.guns_in_pallet);
  return out;
}

const QC_CHECK_KEYS = ['parts','orientation','charges','detcord','wiring','build'];

// AQL ANSI/ASQC Z1.4 — General Inspection Level II.
// Maps a lot size (total guns in the pallet) to the suggested inspection sample size.
// Sample is inspector-editable on the front end; this is only the default suggestion.
function aqlSampleSize(lot: number): number {
  const n = Math.max(0, Math.floor(Number(lot) || 0));
  if (n <= 1) return n;            // inspect the single gun
  if (n <= 8) return 2;
  if (n <= 15) return 3;
  if (n <= 25) return 5;
  if (n <= 50) return 8;
  if (n <= 90) return 13;
  if (n <= 150) return 20;         // 91–150 → 20 (a 100-gun pallet samples 20)
  if (n <= 280) return 32;
  if (n <= 500) return 50;
  if (n <= 1200) return 80;
  if (n <= 3200) return 125;
  if (n <= 10000) return 200;
  if (n <= 35000) return 315;
  return 500;
}

// ── Slip parsing ──────────────────────────────────────────────────────────────
// Parse plain text extracted (browser-side, via pdfjs) from a NetSuite packing
// slip or pallet build slip into structured QC header fields.
function parseSlipText(text: string) {
  const clean = String(text || '').replace(/\r/g, '');
  const get = (re: RegExp) => {
    const m = clean.match(re);
    return m ? m[1].trim() : null;
  };
  const sales_order = get(/Sales Order\s*#?\s*(SO\d+)/i) || get(/#?(SO\d+)\b/i);
  const fulfillment_ids = [...new Set([...clean.matchAll(/IF\d+/gi)].map((m) => m[0].toUpperCase()))];
  const customer = get(/Customer\s*\n\s*([^\n]+)/i);
  const operator = get(/Operator\s*\n\s*([^\n]+)/i);
  const additional_reference = get(/Additional Reference\s*\n\s*([^\n]+)/i);
  const date = get(/Date(?: Built \/ Staged)?\s*\n\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i)
    || get(/\b([0-9]{2}\/[0-9]{2}\/[0-9]{4})\b/);

  const doc_type = /Pallet Build Slip/i.test(clean) ? 'build_slip'
    : /Packing Slip/i.test(clean) ? 'packing_slip' : 'unknown';

  // Gun vs. non-gun (hardware / spare parts) detection. A pallet is QC'd only
  // when it contains perforating guns. Gun signals:
  //   - a loaded-gun header line, e.g. "3 Shot XConnect Loaded Gun"
  //   - a "Banded Barrel" / "Band Barrel" ASM line (loaded guns)
  //   - an UNLOADED gun assembly line, e.g. "RL2.75 Unloaded 3 Shot (3 Band
  //     Barrel) ASM" — this has no "Gun" word and isn't a "Banded Barrel", so it
  //     was previously misread as hardware and skipped QC. Match an
  //     "... <N> Shot ... ASM" gun-assembly line, or any explicit "Unloaded ...
  //     Shot" / "Loaded ... Shot" gun line.
  // Otherwise it is hardware / spare parts and skips QC.
  const gunHeader = get(/(\d+\s*Shot[^\n]*Gun[^\n]*)/i);
  const hasBarrel = /Band(?:ed)? Barrel/i.test(clean);
  const hasGunAsmLine = /(?:un)?loaded[^\n]*\d+\s*Shot[^\n]*ASM/i.test(clean)
    || /\d+\s*Shot[^\n]*\(\s*\d+\s*Band[^\n]*ASM/i.test(clean);
  const is_gun = !!gunHeader || hasBarrel || hasGunAsmLine;
  const item_category = is_gun ? 'guns' : 'hardware';

  // Loaded vs. Unloaded. The signal lives in the item/description text, not in a
  // fixed header: a loaded build slip says "3 Shot XConnect Loaded Gun", while an
  // unloaded slip says "RL2.75 Unloaded 3 Shot (3 Band Barrel) ASM" (no "Gun"
  // word, so the gun-header regex misses it). Scan the whole slip and check
  // "unloaded" FIRST so the substring inside "unloaded" never reads as "loaded".
  let load_type: string | null = null;
  if (is_gun) {
    if (/unloaded/i.test(clean)) load_type = 'unloaded';
    else if (/\bloaded\b/i.test(clean)) load_type = 'loaded';
    else if (gunHeader) load_type = /unloaded/i.test(gunHeader) ? 'unloaded' : (/loaded/i.test(gunHeader) ? 'loaded' : null);
  }

  // Barrel ASM quantity. On a BUILD slip this is the true per-pallet gun count
  // (always <= MAX_GUNS_PER_PALLET). On a PACKING slip it is the whole-order
  // total across every fulfillment, so it is NOT a per-pallet lot.
  let barrel_qty: number | null = null;
  const barrelLine = clean.match(/Banded Barrel[^\n]*\n(?:\s*\n)?\s*(\d+)/i);
  if (barrelLine) barrel_qty = Number(barrelLine[1]);

  // gun_qty = per-pallet lot, only trustworthy from a build slip (and capped).
  // order_qty = full-order total, surfaced from a packing slip for reference.
  let gun_qty: number | null = null;
  let order_qty: number | null = null;
  if (is_gun) {
    if (doc_type === 'build_slip') {
      gun_qty = clampGunsInPallet(barrel_qty);
    } else if (doc_type === 'packing_slip') {
      order_qty = (barrel_qty != null && barrel_qty > 0) ? barrel_qty : null;
      // Do NOT set gun_qty from a packing slip: it is an order total, not a lot.
    } else {
      gun_qty = clampGunsInPallet(barrel_qty);
    }
  }

  // Origin = the XC base the pallet was BUILT/staged at, NOT where it ships to.
  // The build slip carries "Build Location: XConnect Williston Shop"; the
  // additional-reference code (ND_WIL_/ND_MID_) is a secondary hint. Normalize
  // to a known XC base name.
  const build_location = get(/Build Location\s*\n\s*([^\n]+)/i);
  let origin_district: string | null = null;
  if (build_location && /Willist/i.test(build_location)) origin_district = 'Williston';
  else if (build_location && /Midland/i.test(build_location)) origin_district = 'Midland';
  if (!origin_district && additional_reference && /WIL/i.test(additional_reference)) origin_district = 'Williston';
  else if (!origin_district && additional_reference && /MID/i.test(additional_reference)) origin_district = 'Midland';

  // Destination = the CUSTOMER's site/facility, read from the packing slip
  // Ship-To block (we are XC, so the XC base is the origin, never the
  // destination). The first line under "Ship-To Address" is the consignee name;
  // we keep the consignee + as much of the address as we can capture.
  //
  // IMPORTANT: some slips print the "Ship-To Address" label with an EMPTY body
  // (the address column is blank) followed immediately by the ATF block in the
  // extracted text. We must NOT treat ATF lines / labels as an address. So we
  // drop any captured line that is an ATF entry, a bare ATF permit number, or a
  // stray field label. If nothing real remains, destination stays null and the
  // user enters it manually — we never guess it from ATF or the customer name.
  let ship_to: string | null = null;
  let destination: string | null = null;
  if (doc_type === 'packing_slip') {
    const shipBlock = clean.match(/Ship-?To Address\s*\n([\s\S]*?)(?:\n\s*ATF\b|\n\s*Date\b|\n\s*Customer\b|\n\s*Sales Order\b|\n\s*Operator\b)/i);
    if (shipBlock) {
      const isJunkLine = (l: string) =>
        !l ||
        /^ATF\b/i.test(l) ||                         // "ATF Number :", "ATF Expiration ..."
        /^\d-[A-Z]{2}-\d/i.test(l) ||                 // bare ATF permit, e.g. 3-ND-105-33-7J-00162
        /^(Date|Customer|Operator|Sales Order|Pad Name|Well Name|Additional Reference)\b/i.test(l);
      const lines = shipBlock[1]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !isJunkLine(l));
      if (lines.length) {
        ship_to = lines.join(', ');
        destination = ship_to;
      }
    }
  }

  // Packing slip number. NetSuite embeds it in the title line, e.g.
  // "Packing Slip - Sales Order #SO4698-PS-8455" -> PS-8455. Also handle a
  // standalone "Packing Slip #PS-8455" form and a generic "PS-####" fallback.
  let packing_slip_no: string | null = null;
  if (doc_type === 'packing_slip') {
    const norm = (s: string) => s.toUpperCase().replace(/^PS-?/, 'PS-');
    const m = clean.match(/SO\d+-(PS-?\d+)/i)
      || clean.match(/Packing Slip[^\n]*#?\s*(PS-?\d+)/i)
      || clean.match(/\b(PS-?\d+)\b/i);
    if (m) packing_slip_no = norm(m[1]);
  }

  return {
    doc_type, sales_order, packing_slip_no, fulfillment_ids, customer, operator,
    destination, ship_to, origin_district, date, gun_qty, order_qty, load_type,
    is_gun, item_category, requires_qc: is_gun, max_guns_per_pallet: MAX_GUNS_PER_PALLET,
  };
}

// POST /qc-slip/parse  body: { text }  -> parsed fields (no DB writes)
apiRoutes.post("/qc-slip/parse", async (c) => {
  try {
    const body = await c.req.json();
    return c.json(parseSlipText(String(body.text || '')));
  } catch (error) {
    console.error('Error parsing slip:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// POST /qc-pallets/from-slip
// body: { sales_order, customer, operator, destination, load_type, guns_in_pallet?,
//         fulfillment_ids: [..], updated_by }
// Creates one pallet per fulfillment id, sharing the header. Skips IDs that
// already have a pallet (same sales_order + fulfillment_id). Returns created list.
apiRoutes.post("/qc-pallets/from-slip", async (c) => {
  try {
    const body = await c.req.json();
    const ids: string[] = Array.isArray(body.fulfillment_ids)
      ? [...new Set(body.fulfillment_ids.map((x: unknown) => String(x).toUpperCase()).filter(Boolean))]
      : [];
    if (!ids.length) return c.json({ error: 'No fulfillment ids provided' }, 400);

    // Whether these pallets hold perforating guns (QC required) or hardware /
    // spare parts (no QC). Defaults to guns unless explicitly told otherwise.
    const requires_qc = body.requires_qc === false ? false : true;
    const item_category = body.item_category ?? (requires_qc ? 'guns' : 'hardware');

    // Per-pallet gun lot. A build slip gives the true count (capped at MAX);
    // a packing slip carries only an order total, so for gun pallets with no
    // per-pallet count provided we default to the full pallet capacity (MAX),
    // to be verified/adjusted when the build slip is imported or during QC.
    // Hardware pallets never carry a gun lot.
    let guns_in_pallet: number | null = clampGunsInPallet(body.guns_in_pallet);
    if (requires_qc && guns_in_pallet == null) guns_in_pallet = MAX_GUNS_PER_PALLET;
    if (!requires_qc) guns_in_pallet = null;

    const shared = {
      sales_order: body.sales_order ?? null,
      customer: body.customer ?? null,
      operator: body.operator ?? null,
      destination: body.destination ?? null,
      load_type: body.load_type ?? 'loaded',
      guns_in_pallet,
      requires_qc,
      item_category,
      updated_by: body.updated_by ?? null,
    };

    const created: any[] = [];
    const skipped: string[] = [];
    for (const fid of ids) {
      // Skip if a pallet already exists for this SO+IF.
      let existsQ = supabase.from('qc_pallets').select('row_id').eq('fulfillment_id', fid);
      if (shared.sales_order) existsQ = existsQ.eq('sales_order', shared.sales_order);
      const { data: existing } = await existsQ.limit(1);
      if (existing && existing.length) { skipped.push(fid); continue; }

      const row: Record<string, unknown> = {
        ...shared,
        fulfillment_id: fid,
        build_no: shared.sales_order ? `${shared.sales_order}-${fid}` : fid,
        status: 'open',
      };
      const { data, error } = await supabase.from('qc_pallets').insert(row).select().single();
      if (error) {
        console.error('Error creating pallet from slip:', error);
        return c.json({ error: error.message }, 500);
      }
      created.push(data);
    }
    return c.json({ created, skipped });
  } catch (error) {
    console.error('Error in from-slip endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List pallets (most recent first).
apiRoutes.get("/qc-pallets", async (c) => {
  try {
    const { data, error } = await supabase
      .from('qc_pallets').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching qc pallets:', error);
      return c.json({ error: error.message }, 500);
    }
    // Attach per-pallet gun pass counts so the list can show progress.
    const pallets = data || [];
    for (const p of pallets) {
      const { data: guns } = await supabase
        .from('qc_guns').select('result').eq('pallet_row_id', p.row_id);
      const all = guns || [];
      (p as Record<string, unknown>).guns_passed = all.filter((g: any) => g.result === 'pass').length;
      (p as Record<string, unknown>).guns_failed = all.filter((g: any) => g.result === 'fail').length;
      (p as Record<string, unknown>).guns_count = all.length;
    }
    return c.json(pallets);
  } catch (error) {
    console.error('Error in qc-pallets list endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Pallets ready to load — used by the driver module to populate load line items.
// Includes QC-passed gun pallets AND hardware / spare-parts pallets (which skip
// QC entirely, so they are ready as soon as they exist).
apiRoutes.get("/qc-pallets/passed", async (c) => {
  try {
    const { data, error } = await supabase
      .from('qc_pallets').select('*')
      .or('status.eq.passed,requires_qc.eq.false')
      .order('created_at', { ascending: false });
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data || []);
  } catch (error) {
    console.error('Error in qc-pallets passed endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// "Ready to load": QC-passed (or no-QC hardware) pallets that are NOT already
// linked to any driver load. The Driver page uses this to show what's waiting to
// be loaded, grouped by Sales Order. A pallet drops off this list the moment it
// is added to a load (its row_id appears in driver_load_items.source_pallet_row_id).
// NOTE: must be declared before "/qc-pallets/:id" so "ready" isn't captured as an id.
apiRoutes.get("/qc-pallets/ready", async (c) => {
  try {
    const { data: pallets, error } = await supabase
      .from('qc_pallets').select('*')
      .or('status.eq.passed,requires_qc.eq.false')
      .order('created_at', { ascending: false });
    if (error) return c.json({ error: error.message }, 500);

    // Collect every pallet row_id already linked to a load line item.
    const { data: linkedRows, error: linkErr } = await supabase
      .from('driver_load_items')
      .select('source_pallet_row_id')
      .not('source_pallet_row_id', 'is', null);
    if (linkErr) {
      console.error('Error fetching linked load items:', linkErr);
      return c.json({ error: linkErr.message }, 500);
    }
    const linked = new Set(
      (linkedRows || [])
        .map((r: Record<string, unknown>) => r.source_pallet_row_id as string)
        .filter(Boolean)
    );

    const ready = (pallets || []).filter((p: Record<string, unknown>) => !linked.has(p.row_id as string));
    return c.json(ready);
  } catch (error) {
    console.error('Error in qc-pallets ready endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Detail: pallet + its guns (each with its checks).
apiRoutes.get("/qc-pallets/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const { data: pallet, error } = await supabase
      .from('qc_pallets').select('*').eq('row_id', id).single();
    if (error) {
      console.error('Error fetching qc pallet:', error);
      return c.json({ error: error.message }, 500);
    }
    const { data: guns } = await supabase
      .from('qc_guns').select('*').eq('pallet_row_id', id).order('gun_index');
    const gunList = guns || [];
    for (const g of gunList) {
      const { data: checks } = await supabase
        .from('qc_gun_checks').select('*').eq('gun_row_id', g.row_id);
      (g as Record<string, unknown>).checks = checks || [];
    }
    return c.json({ ...pallet, guns: gunList });
  } catch (error) {
    console.error('Error in qc-pallet detail endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.post("/qc-pallets", async (c) => {
  try {
    const body = await c.req.json();
    const { data, error } = await supabase
      .from('qc_pallets').insert(pickQcPallet(body)).select().single();
    if (error) {
      console.error('Error creating qc pallet:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json(data);
  } catch (error) {
    console.error('Error in create qc pallet endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.put("/qc-pallets/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const patch = pickQcPallet(body);
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('qc_pallets').update(patch).eq('row_id', id).select().single();
    if (error) {
      console.error('Error updating qc pallet:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json(data);
  } catch (error) {
    console.error('Error in update qc pallet endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.delete("/qc-pallets/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    // Clean up associated images (slip_pdf, build_slip_photo, qc_photo) first so
    // we don't orphan storage objects / images rows when the pallet is removed.
    try {
      const { files } = await listImagesForRecord('qc_pallets', id);
      for (const f of files || []) {
        if (f?.id) await deleteImageById(f.id);
      }
    } catch (imgErr) {
      console.warn('qc pallet image cleanup warning (continuing):', imgErr);
    }
    const { error } = await supabase.from('qc_pallets').delete().eq('row_id', id);
    if (error) {
      console.error('Error deleting qc pallet:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json({ success: true });
  } catch (error) {
    console.error('Error in delete qc pallet endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Suggest an AQL Level II sample size for a given lot (total guns in pallet).
// GET /qc-aql?lot=100  ->  { lot: 100, sample_size: 20 }
apiRoutes.get("/qc-aql", (c) => {
  const lot = Number(c.req.query('lot')) || 0;
  return c.json({ lot, sample_size: aqlSampleSize(lot) });
});

// Initialise N guns for a pallet (idempotent: replaces the gun set).
// N = the sample size to inspect. Optionally records guns_in_pallet (lot total)
// and sample_size so the pallet captures its sampling context (e.g. 20 of 100).
// Each gun gets the six default check rows in 'pass' state; QC flips to fail/na.
apiRoutes.post("/qc-pallets/:id/guns", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    // Sample size = number of gun records to create. Accept sample_size or
    // (back-compat) guns_total from the body.
    let count = Math.max(0, Math.min(1000, Number(body.sample_size ?? body.guns_total) || 0));
    const lotRaw = body.guns_in_pallet;
    // A pallet holds at most MAX_GUNS_PER_PALLET guns; clamp the lot accordingly.
    const lot = lotRaw === undefined || lotRaw === null || lotRaw === ''
      ? undefined
      : (clampGunsInPallet(lotRaw) ?? 0);
    // Never sample more guns than the pallet actually holds.
    if (lot !== undefined && lot > 0) count = Math.min(count, lot);
    // Wipe existing guns (checks cascade) then re-create.
    await supabase.from('qc_guns').delete().eq('pallet_row_id', id);
    const created: any[] = [];
    for (let i = 1; i <= count; i++) {
      const { data: gun, error: gErr } = await supabase
        .from('qc_guns').insert({ pallet_row_id: id, gun_index: i, result: 'pending' }).select().single();
      if (gErr) {
        console.error('Error inserting qc gun:', gErr);
        return c.json({ error: gErr.message }, 500);
      }
      const checkRows = QC_CHECK_KEYS.map((k) => ({ gun_row_id: gun.row_id, item_key: k, state: 'pass' }));
      await supabase.from('qc_gun_checks').insert(checkRows);
      created.push(gun);
    }
    const patch: Record<string, unknown> = {
      guns_total: count,
      sample_size: count,
      status: count > 0 ? 'in_progress' : 'open',
      updated_at: new Date().toISOString(),
    };
    if (lot !== undefined) patch.guns_in_pallet = lot;
    await supabase.from('qc_pallets').update(patch).eq('row_id', id);
    return c.json({ guns_total: count, sample_size: count, guns_in_pallet: lot ?? null, guns: created });
  } catch (error) {
    console.error('Error in qc-pallet guns init endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Record a gun's checks + result. Body: { checks: [{item_key,state,note}], serial, notes, inspected_by }
apiRoutes.put("/qc-guns/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const checks: any[] = Array.isArray(body.checks) ? body.checks : [];
    // Replace checks for this gun.
    await supabase.from('qc_gun_checks').delete().eq('gun_row_id', id);
    if (checks.length) {
      const rows = checks
        .filter((ck) => QC_CHECK_KEYS.includes(ck.item_key))
        .map((ck) => ({
          gun_row_id: id,
          item_key: ck.item_key,
          state: ['pass','fail','na'].includes(ck.state) ? ck.state : 'pass',
          note: ck.note ?? null,
        }));
      if (rows.length) await supabase.from('qc_gun_checks').insert(rows);
    }
    // A gun fails if any check is 'fail'; otherwise it passes (na counts as ok).
    const anyFail = checks.some((ck) => ck.state === 'fail');
    const result = anyFail ? 'fail' : 'pass';
    const { data: gun, error } = await supabase
      .from('qc_guns').update({
        result,
        serial: body.serial ?? null,
        notes: body.notes ?? null,
        inspected_by: body.inspected_by ?? null,
        inspected_at: new Date().toISOString(),
      }).eq('row_id', id).select().single();
    if (error) {
      console.error('Error updating qc gun:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json(gun);
  } catch (error) {
    console.error('Error in qc-gun update endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Sign off a pallet. Only allowed when every gun has passed (and there is >=1 gun).
apiRoutes.post("/qc-pallets/:id/signoff", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const user = c.get('user');
    const { data: guns } = await supabase
      .from('qc_guns').select('result').eq('pallet_row_id', id);
    const all = guns || [];
    const total = all.length;
    const passed = all.filter((g: any) => g.result === 'pass').length;
    if (total === 0) {
      return c.json({ error: 'Cannot sign off: no guns have been inspected on this pallet.' }, 400);
    }
    if (passed !== total) {
      return c.json({ error: `Cannot sign off: ${total - passed} of ${total} guns have not passed.` }, 400);
    }
    // Require a photo of the physical pallet build slip as verification evidence.
    const { data: verifyPhotos } = await supabase
      .from('images')
      .select('id')
      .eq('parent_table', 'qc_pallets')
      .eq('parent_row_id', id)
      .eq('field_name', 'build_slip_photo')
      .limit(1);
    if (!verifyPhotos || verifyPhotos.length === 0) {
      return c.json({ error: 'Cannot sign off: attach a photo of the physical pallet build slip first.' }, 400);
    }
    const signer = body.signed_off_by || user?.email || null;
    const { data, error } = await supabase
      .from('qc_pallets').update({
        status: 'passed',
        signed_off_by: signer,
        signed_off_at: new Date().toISOString(),
        updated_by: signer,
        updated_at: new Date().toISOString(),
      }).eq('row_id', id).select().single();
    if (error) {
      console.error('Error signing off qc pallet:', error);
      return c.json({ error: error.message }, 500);
    }
    return c.json(data);
  } catch (error) {
    console.error('Error in qc-pallet signoff endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ FILE UPLOADS FOR INCIDENTS ============

// Upload incident image
apiRoutes.post("/incidents/:incidentId/upload", async (c) => {
  try {
    const incidentId = c.req.param('incidentId');
    const formData = await c.req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const result = await uploadIncidentImage(file, incidentId);

    if (result.error) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({ url: result.url });
  } catch (error) {
    console.error('Error in upload endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List incident images
apiRoutes.get("/incidents/:incidentId/images", async (c) => {
  try {
    const incidentId = c.req.param('incidentId');
    const result = await listIncidentImages(incidentId);

    if (result.error) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({ files: result.files });
  } catch (error) {
    console.error('Error in list images endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete incident image
apiRoutes.delete("/incidents/images", requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { filePath } = body;

    if (!filePath) {
      return c.json({ error: 'No file path provided' }, 400);
    }

    const result = await deleteIncidentImage(filePath);

    if (result.error) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error in delete image endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ POLYMORPHIC IMAGE ROUTES ============
// Upload an image for any parent record (incidents, panels, panel_history, customers, districts, fieldvisits, components)
apiRoutes.post("/images/:parentTable/:parentRowId", async (c) => {
  try {
    const parentTable = c.req.param('parentTable');
    const parentRowId = c.req.param('parentRowId');
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const fieldName = (formData.get('fieldName') as string) || undefined;
    const caption = (formData.get('caption') as string) || undefined;
    const source = ((formData.get('source') as string) || 'user') as 'user' | 'appsheet' | 'system';

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const result = await uploadImage(file, parentTable, parentRowId, {
      fieldName,
      caption,
      source,
    });

    if (result.error) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({
      id: result.id,
      url: result.url,
      storagePath: result.storagePath,
    });
  } catch (error) {
    console.error('Error in polymorphic upload endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List images for any parent record (returns signed URLs)
apiRoutes.get("/images/:parentTable/:parentRowId", async (c) => {
  try {
    const parentTable = c.req.param('parentTable');
    const parentRowId = c.req.param('parentRowId');

    const result = await listImagesForRecord(parentTable, parentRowId);

    if (result.error) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({ files: result.files });
  } catch (error) {
    console.error('Error in polymorphic list images endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Delete an image by its id (removes storage object + DB row)
apiRoutes.delete("/images/:imageId", requireAdmin, async (c) => {
  try {
    const imageId = c.req.param('imageId');

    if (!imageId) {
      return c.json({ error: 'No image id provided' }, 400);
    }

    const result = await deleteImageById(imageId);

    if (result.error) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error in delete image-by-id endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Generate incident report PDF
apiRoutes.post("/incidents/:id/generate-report", async (c) => {
  try {
    const id = c.req.param('id');
    
    console.log(`Generating PDF report for incident: ${id}`);
    
    const pdfUrl = await generateIncidentReportPDF(id);

    return c.json({ 
      success: true, 
      url: pdfUrl,
      message: 'PDF report generated successfully'
    });
  } catch (error) {
    console.error('Error generating incident report:', error);
    return c.json({ 
      error: error instanceof Error ? error.message : String(error) 
    }, 500);
  }
});

// ============ KPI REPORTS ============

// Get KPI data for a customer with optional district filter
apiRoutes.get("/kpi/:customerId/:districtId", async (c) => {
  try {
    const customerId = c.req.param('customerId');
    const districtId = c.req.param('districtId');
    
    console.log(`Generating KPI for customer: ${customerId}, district: ${districtId}`);
    
    // Get customer and district names for foreign key lookups
    const { data: customer } = await supabase
      .from('customers')
      .select('customer')
      .eq('row_id', customerId)
      .single();
    
    const { data: district } = await supabase
      .from('districts')
      .select('customer_district')
      .eq('row_id', districtId)
      .single();
    
    const customerName = customer?.customer;
    const districtName = district?.customer_district;
    
    // Build base query filters
    const districtFilter = { customer: customerId, customer_district: districtId };
    
    // Get field visits count and total hours
    const { data: visits, error: visitsError } = await supabase
      .from('fieldvisits')
      .select('visit_duration')
      .match(districtFilter);
    
    if (visitsError) {
      console.error('Error fetching visits:', visitsError);
    }
    
    const visitCount = visits?.length || 0;
    const totalVisitHours = visits?.reduce((sum, v) => sum + (parseFloat(v.visit_duration) || 0), 0) || 0;
    
    // Get sales data from sales_volume - use NAMES, not row_ids
    const { data: barrelsData, error: barrelsError } = await supabase
      .from('sales_volume')
      .select('quantity')
      .eq('metric_type', 'barrels')
      .eq('customer', customerName)
      .eq('customer_district', districtName);
    
    if (barrelsError) {
      console.error('Error fetching barrels:', barrelsError);
    }
    
    const { data: stagesData, error: stagesError } = await supabase
      .from('sales_volume')
      .select('quantity')
      .eq('metric_type', 'stages')
      .eq('customer', customerName)
      .eq('customer_district', districtName);
    
    if (stagesError) {
      console.error('Error fetching stages:', stagesError);
    }
    
    const totalBarrels = barrelsData?.reduce((sum, b) => sum + (parseInt(b.quantity) || 0), 0) || 0;
    const totalStages = stagesData?.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0) || 0;
    
    // Get panel data
    const { data: panels, error: panelsError } = await supabase
      .from('panels')
      .select('panel_status')
      .match(districtFilter);
    
    if (panelsError) {
      console.error('Error fetching panels:', panelsError);
    }
    
    const totalPanels = panels?.length || 0;
    const installedPanels = panels?.filter(p => p.panel_status === 'Installed').length || 0;
    
    // Get incidents count
    const { data: incidents, error: incidentsError } = await supabase
      .from('incidents')
      .select('row_id')
      .match(districtFilter);
    
    if (incidentsError) {
      console.error('Error fetching incidents:', incidentsError);
    }
    
    const totalIncidents = incidents?.length || 0;
    
    return c.json({
      kpis: {
        visitCount,
        totalVisitHours: Math.round(totalVisitHours * 100) / 100,
        totalBarrels,
        totalStages,
        totalPanels,
        installedPanels,
        totalIncidents,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error generating KPI report:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get KPI data for a customer (all districts)
apiRoutes.get("/kpi/:customerId", async (c) => {
  try {
    const customerId = c.req.param('customerId');
    
    console.log(`Generating KPI for customer: ${customerId}, all districts`);
    
    // Get customer name for foreign key lookups
    const { data: customer } = await supabase
      .from('customers')
      .select('customer')
      .eq('row_id', customerId)
      .single();
    
    const customerName = customer?.customer;
    
    // Build base query filters
    const customerFilter = { customer: customerId };
    
    // Get field visits count and total hours
    const { data: visits, error: visitsError } = await supabase
      .from('fieldvisits')
      .select('visit_duration')
      .match(customerFilter);
    
    if (visitsError) {
      console.error('Error fetching visits:', visitsError);
    }
    
    const visitCount = visits?.length || 0;
    const totalVisitHours = visits?.reduce((sum, v) => sum + (parseFloat(v.visit_duration) || 0), 0) || 0;
    
    // Get sales data from sales_volume - use customer NAME, not row_id
    const { data: barrelsData, error: barrelsError } = await supabase
      .from('sales_volume')
      .select('quantity')
      .eq('metric_type', 'barrels')
      .eq('customer', customerName);
    
    if (barrelsError) {
      console.error('Error fetching barrels:', barrelsError);
    }
    
    const { data: stagesData, error: stagesError } = await supabase
      .from('sales_volume')
      .select('quantity')
      .eq('metric_type', 'stages')
      .eq('customer', customerName);
    
    if (stagesError) {
      console.error('Error fetching stages:', stagesError);
    }
    
    const totalBarrels = barrelsData?.reduce((sum, b) => sum + (parseInt(b.quantity) || 0), 0) || 0;
    const totalStages = stagesData?.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0) || 0;
    
    // Get panel data
    const { data: panels, error: panelsError } = await supabase
      .from('panels')
      .select('panel_status')
      .match(customerFilter);
    
    if (panelsError) {
      console.error('Error fetching panels:', panelsError);
    }
    
    const totalPanels = panels?.length || 0;
    const installedPanels = panels?.filter(p => p.panel_status === 'Installed').length || 0;
    
    // Get incidents count
    const { data: incidents, error: incidentsError } = await supabase
      .from('incidents')
      .select('row_id')
      .match(customerFilter);
    
    if (incidentsError) {
      console.error('Error fetching incidents:', incidentsError);
    }
    
    const totalIncidents = incidents?.length || 0;
    
    return c.json({
      kpis: {
        visitCount,
        totalVisitHours: Math.round(totalVisitHours * 100) / 100,
        totalBarrels,
        totalStages,
        totalPanels,
        installedPanels,
        totalIncidents,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error generating KPI report:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get company-wide KPI summary
apiRoutes.get("/kpi/company/summary", async (c) => {
  try {
    console.log('=== Generating company-wide KPI summary ===');
    
    // Get all field visits
    const { data: visits, error: visitsError } = await supabase
      .from('fieldvisits')
      .select('visit_duration');
    
    if (visitsError) {
      console.error('Error fetching visits:', visitsError);
    }
    console.log(`Visits count: ${visits?.length || 0}`);
    
    const visitCount = visits?.length || 0;
    const totalVisitHours = visits?.reduce((sum, v) => sum + (parseFloat(v.visit_duration) || 0), 0) || 0;
    
    // Get all sales data from sales_volume
    const { data: barrelsData, error: barrelsError } = await supabase
      .from('sales_volume')
      .select('quantity')
      .eq('metric_type', 'barrels');
    
    if (barrelsError) {
      console.error('Error fetching barrels:', barrelsError);
    }
    console.log(`Barrels rows: ${barrelsData?.length || 0}`);
    
    const { data: stagesData, error: stagesError } = await supabase
      .from('sales_volume')
      .select('quantity')
      .eq('metric_type', 'stages');
    
    if (stagesError) {
      console.error('Error fetching stages:', stagesError);
    }
    console.log(`Stages rows: ${stagesData?.length || 0}`);
    
    const totalBarrels = barrelsData?.reduce((sum, b) => sum + (parseInt(b.quantity) || 0), 0) || 0;
    const totalStages = stagesData?.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0) || 0;
    console.log(`Total barrels: ${totalBarrels}, Total stages: ${totalStages}`);
    
    // Get all panel data
    const { data: panels, error: panelsError} = await supabase
      .from('panels')
      .select('panel_status');
    
    if (panelsError) {
      console.error('Error fetching panels:', panelsError);
    }
    console.log(`Panels count: ${panels?.length || 0}`);
    
    const totalPanels = panels?.length || 0;
    const installedPanels = panels?.filter(p => p.panel_status === 'Installed').length || 0;
    
    // Get all incidents
    const { data: incidents, error: incidentsError } = await supabase
      .from('incidents')
      .select('row_id');
    
    if (incidentsError) {
      console.error('Error fetching incidents:', incidentsError);
    }
    console.log(`Incidents count: ${incidents?.length || 0}`);
    
    const totalIncidents = incidents?.length || 0;
    
    // Get customer count
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('row_id');
    
    if (customersError) {
      console.error('Error fetching customers:', customersError);
    }
    console.log(`Customers count: ${customers?.length || 0}`);
    
    const totalCustomers = customers?.length || 0;
    
    const result = {
      kpis: {
        visitCount,
        totalVisitHours: Math.round(totalVisitHours * 100) / 100,
        totalBarrels,
        totalStages,
        totalPanels,
        installedPanels,
        totalIncidents,
        totalCustomers,
        generatedAt: new Date().toISOString()
      }
    };
    
    console.log('=== Final company KPI result ===', JSON.stringify(result, null, 2));
    
    return c.json(result);
  } catch (error) {
    console.error('Error generating company KPI summary:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ SINGLE ITEM DETAILS WITH KPIs ============

// Get single field visit
apiRoutes.get("/field-visits/:id", async (c) => {
  try {
    const id = c.req.param('id');
    
    const { data, error } = await supabase
      .from('fieldvisits')
      .select('*')
      .eq('row_id', id)
      .single();

    if (error) {
      console.error('Error fetching field visit:', error);
      return c.json({ error: error.message }, 404);
    }

    // Enrich with customer and district names
    let customerName = null;
    let districtName = null;

    if (data.customer) {
      const { data: customer } = await supabase
        .from('customers')
        .select('customer, customer_logo')
        .eq('row_id', data.customer)
        .single();
      customerName = customer?.customer;
    }

    if (data.customer_district) {
      const { data: district } = await supabase
        .from('districts')
        .select('customer_district')
        .eq('row_id', data.customer_district)
        .single();
      districtName = district?.customer_district;
    }

    return c.json({
      ...data,
      customerName,
      districtName
    });
  } catch (error) {
    console.error('Error in field visit detail endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get single incident
apiRoutes.get("/incidents/:id", async (c) => {
  try {
    const id = c.req.param('id');
    
    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .eq('row_id', id)
      .single();

    if (error) {
      console.error('Error fetching incident:', error);
      return c.json({ error: error.message }, 404);
    }

    // Enrich with customer and district names
    let customerName = null;
    let districtName = null;

    if (data.customer) {
      const { data: customer } = await supabase
        .from('customers')
        .select('customer, customer_logo')
        .eq('row_id', data.customer)
        .single();
      customerName = customer?.customer;
    }

    if (data.customer_district) {
      const { data: district } = await supabase
        .from('districts')
        .select('customer_district')
        .eq('row_id', data.customer_district)
        .single();
      districtName = district?.customer_district;
    }

    return c.json({
      ...data,
      customerName,
      districtName
    });
  } catch (error) {
    console.error('Error in incident detail endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get single panel
apiRoutes.get("/panels/:id", async (c) => {
  try {
    const id = c.req.param('id');
    
    const { data, error } = await supabase
      .from('panels')
      .select('*')
      .eq('row_id', id)
      .single();

    if (error) {
      console.error('Error fetching panel:', error);
      return c.json({ error: error.message }, 404);
    }

    // Enrich with customer and district names
    let customerName = null;
    let districtName = null;

    if (data.customer) {
      const { data: customer } = await supabase
        .from('customers')
        .select('customer, customer_logo')
        .eq('row_id', data.customer)
        .single();
      customerName = customer?.customer;
    }

    if (data.customer_district) {
      const { data: district } = await supabase
        .from('districts')
        .select('customer_district')
        .eq('row_id', data.customer_district)
        .single();
      districtName = district?.customer_district;
    }

    return c.json({
      ...data,
      customerName,
      districtName
    });
  } catch (error) {
    console.error('Error in panel detail endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get single customer with detailed KPIs
apiRoutes.get("/customers/:id/details", async (c) => {
  try {
    const id = c.req.param('id');
    
    const { data: customer, error } = await supabase
      .from('customers')
      .select('*')
      .eq('row_id', id)
      .single();

    if (error) {
      console.error('Error fetching customer:', error);
      return c.json({ error: error.message }, 404);
    }

    // Get the customer name to use for foreign key lookups
    const customerName = customer.customer;

    // Get all districts for this customer
    const { data: districts } = await supabase
      .from('districts')
      .select('*')
      .eq('customer', id);

    // Get field visits with duration metrics
    const { data: visits } = await supabase
      .from('fieldvisits')
      .select('visit_duration, arrival_date, departure_date')
      .eq('customer', id);
    
    const visitCount = visits?.length || 0;
    const totalVisitHours = visits?.reduce((sum, v) => sum + (parseFloat(v.visit_duration) || 0), 0) || 0;
    const avgVisitHours = visitCount > 0 ? totalVisitHours / visitCount : 0;

    // Get sales data - use customer NAME, not row_id
    const { data: barrelsData, error: barrelsError } = await supabase
      .from('sales_volume')
      .select('quantity, date, customer_district, customer')
      .eq('metric_type', 'barrels')
      .eq('customer', customerName);
    
    if (barrelsError) {
      console.error('Error fetching barrels for customer:', barrelsError);
    }
    
    console.log(`Customer ${customerName} (ID: ${id}) - Barrels data count: ${barrelsData?.length || 0}`);
    
    const { data: stagesData, error: stagesError } = await supabase
      .from('sales_volume')
      .select('quantity, date, customer_district, customer')
      .eq('metric_type', 'stages')
      .eq('customer', customerName);
    
    if (stagesError) {
      console.error('Error fetching stages for customer:', stagesError);
    }
    
    console.log(`Customer ${customerName} (ID: ${id}) - Stages data count: ${stagesData?.length || 0}`);
    
    const totalBarrels = barrelsData?.reduce((sum, b) => sum + (parseInt(b.quantity) || 0), 0) || 0;
    const totalStages = stagesData?.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0) || 0;

    // Get panels
    const { data: panels } = await supabase
      .from('panels')
      .select('*')
      .eq('customer', id);
    
    const totalPanels = panels?.length || 0;
    const installedPanels = panels?.filter(p => p.panel_status === 'Installed').length || 0;

    // Get incidents with XC Caused breakdown
    const { data: allIncidents } = await supabase
      .from('incidents')
      .select('xc_caused')
      .eq('customer', id);
    
    const totalIncidents = allIncidents?.length || 0;
    const xcCausedNo = allIncidents?.filter(i => i.xc_caused === 'No').length || 0;
    const xcCausedYes = totalIncidents - xcCausedNo;

    // Calculate KPIs (using XC Caused = Yes for performance metrics)
    const incidentsPerBarrel = totalBarrels > 0 ? (xcCausedYes / totalBarrels) : 0;
    const incidentsPerBarrelPct = totalBarrels > 0 ? (xcCausedYes / totalBarrels * 100) : 0;
    const incidentsPerStage = totalStages > 0 ? (xcCausedYes / totalStages) : 0;
    const incidentsPerStagePct = totalStages > 0 ? (xcCausedYes / totalStages * 100) : 0;

    return c.json({
      customer,
      districts: districts || [],
      kpis: {
        visitCount,
        totalVisitHours: Math.round(totalVisitHours * 100) / 100,
        avgVisitHours: Math.round(avgVisitHours * 100) / 100,
        totalBarrels,
        totalStages,
        totalPanels,
        installedPanels,
        totalIncidents,
        xcCausedNo,
        xcCausedYes,
        incidentsPerBarrel: Math.round(incidentsPerBarrel * 10000) / 10000,
        incidentsPerBarrelPct: Math.round(incidentsPerBarrelPct * 100) / 100,
        incidentsPerStage: Math.round(incidentsPerStage * 10000) / 10000,
        incidentsPerStagePct: Math.round(incidentsPerStagePct * 100) / 100
      },
      salesData: { barrelsData, stagesData }
    });
  } catch (error) {
    console.error('Error in customer detail endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Get single district with detailed KPIs
apiRoutes.get("/districts/:id/details", async (c) => {
  try {
    const id = c.req.param('id');
    
    const { data: district, error } = await supabase
      .from('districts')
      .select('*')
      .eq('row_id', id)
      .single();

    if (error) {
      console.error('Error fetching district:', error);
      return c.json({ error: error.message }, 404);
    }

    // Get customer info
    let customerInfo = null;
    if (district.customer) {
      const { data: customer } = await supabase
        .from('customers')
        .select('customer, customer_logo')
        .eq('row_id', district.customer)
        .single();
      customerInfo = customer;
    }

    // Get the district name to use for foreign key lookups
    const districtName = district.customer_district;

    // Get field visits with duration metrics
    const { data: visits } = await supabase
      .from('fieldvisits')
      .select('visit_duration, arrival_date, departure_date')
      .eq('customer_district', id);
    
    const visitCount = visits?.length || 0;
    const totalVisitHours = visits?.reduce((sum, v) => sum + (parseFloat(v.visit_duration) || 0), 0) || 0;
    const avgVisitHours = visitCount > 0 ? totalVisitHours / visitCount : 0;

    // Get sales data - use district NAME, not row_id
    const { data: barrelsData } = await supabase
      .from('sales_volume')
      .select('quantity, date')
      .eq('metric_type', 'barrels')
      .eq('customer_district', districtName);
    
    const { data: stagesData } = await supabase
      .from('sales_volume')
      .select('quantity, date')
      .eq('metric_type', 'stages')
      .eq('customer_district', districtName);
    
    const totalBarrels = barrelsData?.reduce((sum, b) => sum + (parseInt(b.quantity) || 0), 0) || 0;
    const totalStages = stagesData?.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0) || 0;

    // Get panels
    const { data: panels } = await supabase
      .from('panels')
      .select('*')
      .eq('customer_district', id);
    
    const totalPanels = panels?.length || 0;
    const installedPanels = panels?.filter(p => p.panel_status === 'Installed').length || 0;

    // Get incidents with XC Caused breakdown
    const { data: allIncidents } = await supabase
      .from('incidents')
      .select('xc_caused')
      .eq('customer_district', id);
    
    const totalIncidents = allIncidents?.length || 0;
    const xcCausedNo = allIncidents?.filter(i => i.xc_caused === 'No').length || 0;
    const xcCausedYes = totalIncidents - xcCausedNo;

    // Calculate KPIs (using XC Caused = Yes for performance metrics)
    const incidentsPerBarrel = totalBarrels > 0 ? (xcCausedYes / totalBarrels) : 0;
    const incidentsPerBarrelPct = totalBarrels > 0 ? (xcCausedYes / totalBarrels * 100) : 0;
    const incidentsPerStage = totalStages > 0 ? (xcCausedYes / totalStages) : 0;
    const incidentsPerStagePct = totalStages > 0 ? (xcCausedYes / totalStages * 100) : 0;

    return c.json({
      district,
      customerInfo,
      kpis: {
        visitCount,
        totalVisitHours: Math.round(totalVisitHours * 100) / 100,
        avgVisitHours: Math.round(avgVisitHours * 100) / 100,
        totalBarrels,
        totalStages,
        totalPanels,
        installedPanels,
        totalIncidents,
        xcCausedNo,
        xcCausedYes,
        incidentsPerBarrel: Math.round(incidentsPerBarrel * 10000) / 10000,
        incidentsPerBarrelPct: Math.round(incidentsPerBarrelPct * 100) / 100,
        incidentsPerStage: Math.round(incidentsPerStage * 10000) / 10000,
        incidentsPerStagePct: Math.round(incidentsPerStagePct * 100) / 100
      },
      salesData: { barrelsData, stagesData }
    });
  } catch (error) {
    console.error('Error in district detail endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ============ DEBUG: ROW COUNTS ============

apiRoutes.get("/debug/row-counts", requireAdmin, async (c) => {
  try {
    // Get exact row counts using head: true (doesn't fetch data, just counts)
    const { count: stagesCount } = await supabase
      .from('sales_volume')
      .select('*', { count: 'exact', head: true })
      .eq('metric_type', 'stages');
    
    const { count: barrelsCount } = await supabase
      .from('sales_volume')
      .select('*', { count: 'exact', head: true })
      .eq('metric_type', 'barrels');
    
    // Fetch all stages data with pagination to sum quantities
    let allStagesData: any[] = [];
    let stagesPage = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase
        .from('sales_volume')
        .select('quantity')
        .eq('metric_type', 'stages')
        .range(stagesPage * pageSize, (stagesPage + 1) * pageSize - 1);
      if (!data || data.length === 0) break;
      allStagesData = [...allStagesData, ...data];
      if (data.length < pageSize) break;
      stagesPage++;
    }
    const stagesQuantity = allStagesData.reduce((sum, s) => sum + (parseInt(s.quantity) || 0), 0);
    
    // Fetch all barrels data with pagination to sum quantities
    let allBarrelsData: any[] = [];
    let barrelsPage = 0;
    while (true) {
      const { data } = await supabase
        .from('sales_volume')
        .select('quantity')
        .eq('metric_type', 'barrels')
        .range(barrelsPage * pageSize, (barrelsPage + 1) * pageSize - 1);
      if (!data || data.length === 0) break;
      allBarrelsData = [...allBarrelsData, ...data];
      if (data.length < pageSize) break;
      barrelsPage++;
    }
    const barrelsQuantity = allBarrelsData.reduce((sum, b) => sum + (parseInt(b.quantity) || 0), 0);
    
    const { count: customersCount } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true });
    
    const { count: districtsCount } = await supabase
      .from('districts')
      .select('*', { count: 'exact', head: true });
    
    // Correct table name: fieldvisits not field_visits
    const { count: visitsCount } = await supabase
      .from('fieldvisits')
      .select('*', { count: 'exact', head: true });
    
    const { count: incidentsCount } = await supabase
      .from('incidents')
      .select('*', { count: 'exact', head: true });
    
    // Get panel counts by type with pagination
    let allPanelsData: any[] = [];
    let panelsPage = 0;
    while (true) {
      const { data } = await supabase
        .from('panels')
        .select('panel_type')
        .range(panelsPage * pageSize, (panelsPage + 1) * pageSize - 1);
      if (!data || data.length === 0) break;
      allPanelsData = [...allPanelsData, ...data];
      if (data.length < pageSize) break;
      panelsPage++;
    }
    
    const panelsByType: Record<string, number> = {};
    allPanelsData.forEach(p => {
      const type = p.panel_type || 'Unknown';
      panelsByType[type] = (panelsByType[type] || 0) + 1;
    });
    
    console.log(`Debug counts - Barrels: ${barrelsCount} rows, Stages: ${stagesCount} rows`);
    
    return c.json({
      stages: {
        rows: stagesCount || 0,
        totalQuantity: stagesQuantity
      },
      barrels_sold: {
        rows: barrelsCount || 0,
        totalQuantity: barrelsQuantity
      },
      customers: customersCount || 0,
      customer_districts: districtsCount || 0,
      field_visits: visitsCount || 0,
      incidents: incidentsCount || 0,
      panels: {
        total: allPanelsData.length,
        byType: panelsByType
      }
    });
  } catch (error) {
    console.error('Error getting row counts:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Send incident report to customer.
//
// This used to live in a Netlify function (/api/send-incident-report), but the
// app is deployed via Codespaces/Vite + Supabase edge, where Netlify functions
// don't run (the old endpoint 404'd). The send now lives here on the edge so it
// works in dev and prod through the same base path every other API call uses.
//
// Email delivery is provider-agnostic and defaults to 'log' (simulated) when no
// provider is configured, so the generate → send → close workflow completes
// end-to-end without a mail provider. Configure later via edge env:
//   MAIL_PROVIDER = resend | sendgrid | log   (default: log)
//   MAIL_FROM, MAIL_REPLY_TO
//   RESEND_API_KEY  (when MAIL_PROVIDER=resend)
//   SENDGRID_API_KEY (when MAIL_PROVIDER=sendgrid)
//
// Returns { ok, sentAt, provider, simulated, auditError } — the shape the
// client (sendIncidentReport.ts) already expects.
const RESEND_API   = 'https://api.resend.com/emails';
const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL   = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

// Exchange a long-lived Gmail refresh token for a short-lived access token.
async function getGmailAccessToken(): Promise<string> {
  const clientId     = Deno.env.get('GMAIL_CLIENT_ID');
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET');
  const refreshToken = Deno.env.get('GMAIL_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail not configured: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Gmail token refresh failed (${resp.status}): ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (!data.access_token) throw new Error('Gmail token refresh returned no access_token');
  return data.access_token as string;
}

// Base64url-encode a UTF-8 string (Gmail API requires base64url of the raw MIME).
function base64UrlEncodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Build an RFC 2822 MIME message (plain-text body + optional base64 PDF) and
// return it base64url-encoded for the Gmail send endpoint.
function buildGmailRawMessage(
  { from, to, replyTo, subject, body, pdfBase64, pdfFilename }:
    { from: string; to: string[]; replyTo?: string; subject: string; body: string; pdfBase64?: string; pdfFilename?: string },
): string {
  const boundary = `xc_mime_${crypto.randomUUID().replace(/-/g, '')}`;
  const headers: string[] = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ];
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);

  if (!pdfBase64) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    return base64UrlEncodeUtf8(`${headers.join('\r\n')}\r\n\r\n${body}`);
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  // Gmail wants standard base64 (with line breaks) for attachment parts.
  const wrapped = (pdfBase64.match(/.{1,76}/g) || [pdfBase64]).join('\r\n');
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${pdfFilename || 'incident-report.pdf'}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${pdfFilename || 'incident-report.pdf'}"`,
    '',
    wrapped,
    '',
    `--${boundary}--`,
    '',
  ];
  return base64UrlEncodeUtf8(`${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`);
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizeRecipients(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((s) => String(s).trim()).filter(isLikelyEmail);
  }
  return String(input ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(isLikelyEmail);
}

function parseFromAddress(addr: string): { name?: string; email: string } {
  const m = addr.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1], email: m[2] };
  return { email: addr };
}

function composeEmailBody(
  { message, eventId, senderName }: { message?: string; eventId?: string; senderName?: string | null },
): string {
  const greeting = 'Hello,';
  const intro = eventId
    ? `Attached is the incident report for Event #${eventId}.`
    : 'Attached is the incident report you requested.';
  const note = message && message.trim() ? `\n\n${message.trim()}` : '';
  const signoff = senderName
    ? `\n\nRegards,\n${senderName}\nXConnect Field Service`
    : '\n\nRegards,\nXConnect Field Service';
  return `${greeting}\n\n${intro}${note}${signoff}\n`;
}

async function sendIncidentEmail(
  { to, subject, body, pdfBase64, pdfFilename, senderName, senderEmail }:
    { to: string[]; subject: string; body: string; pdfBase64?: string; pdfFilename?: string; senderName?: string | null; senderEmail?: string | null },
): Promise<{ provider: string; simulated?: boolean; id?: string | null }> {
  if (!to || !to.length) throw new Error('No recipient addresses provided');

  const provider = (Deno.env.get('MAIL_PROVIDER') || 'log').toLowerCase();

  const fallbackFrom = Deno.env.get('MAIL_FROM') || 'XConnect Field Service <no-reply@xconnect.local>';
  const senderAddr = (senderEmail || '').trim();
  let from = fallbackFrom;
  let replyTo: string | undefined = Deno.env.get('MAIL_REPLY_TO') || undefined;

  if (provider === 'gmail') {
    // Single-mailbox model: the OAuth token belongs to ONE Gmail account, so
    // the From MUST be that mailbox (MAIL_FROM, e.g. Robert@xcperf.com) — Gmail
    // rejects a mismatched From. We still set Reply-To to the logged-in user so
    // customer replies reach the person who sent it.
    from = fallbackFrom;
    if (senderAddr && isLikelyEmail(senderAddr)) {
      replyTo = senderAddr;
    }
  } else {
    // Resend / SendGrid: send AS the logged-in user (their own address), with
    // replies routed back to them. When MAIL_FROM_DOMAIN is configured the
    // sender's domain must match the authenticated mail domain, otherwise the
    // provider would reject the send. MAIL_FROM is the no-sender fallback.
    const fromDomain = (Deno.env.get('MAIL_FROM_DOMAIN') || '').trim().toLowerCase();
    if (senderAddr && isLikelyEmail(senderAddr)) {
      const senderDomain = senderAddr.split('@')[1]?.toLowerCase() || '';
      if (fromDomain && senderDomain !== fromDomain) {
        throw new Error(
          `Sender ${senderAddr} is not on the authenticated mail domain (${fromDomain}). ` +
          `Configure MAIL_FROM_DOMAIN or authenticate this domain in the mail provider.`,
        );
      }
      from = senderName ? `${senderName} <${senderAddr}>` : senderAddr;
      replyTo = senderAddr;
    }
  }

  if (provider === 'log') {
    console.log('[send-report] MAIL_PROVIDER=log — would have sent:', {
      to, subject, from, pdfFilename,
      pdfBytes: pdfBase64 ? Math.floor((pdfBase64.length * 3) / 4) : 0,
    });
    return { provider, simulated: true };
  }

  if (provider === 'resend') {
    const key = Deno.env.get('RESEND_API_KEY');
    if (!key) throw new Error('RESEND_API_KEY is not set');
    const resp = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to, reply_to: replyTo, subject, text: body,
        attachments: pdfBase64
          ? [{ filename: pdfFilename || 'incident-report.pdf', content: pdfBase64 }]
          : [],
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Resend send failed (${resp.status}): ${txt.slice(0, 500)}`);
    }
    const data = await resp.json().catch(() => ({}));
    return { provider, id: data.id || null };
  }

  if (provider === 'sendgrid') {
    const key = Deno.env.get('SENDGRID_API_KEY');
    if (!key) throw new Error('SENDGRID_API_KEY is not set');
    const resp = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: to.map((email) => ({ email })) }],
        from: parseFromAddress(from),
        reply_to: replyTo ? parseFromAddress(replyTo) : undefined,
        subject,
        content: [{ type: 'text/plain', value: body }],
        attachments: pdfBase64
          ? [{ content: pdfBase64, filename: pdfFilename || 'incident-report.pdf', type: 'application/pdf', disposition: 'attachment' }]
          : undefined,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`SendGrid send failed (${resp.status}): ${txt.slice(0, 500)}`);
    }
    return { provider, id: resp.headers.get('x-message-id') || null };
  }

  if (provider === 'gmail') {
    const accessToken = await getGmailAccessToken();
    const raw = buildGmailRawMessage({ from, to, replyTo, subject, body, pdfBase64, pdfFilename });
    const resp = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Gmail send failed (${resp.status}): ${txt.slice(0, 500)}`);
    }
    const data = await resp.json().catch(() => ({}));
    return { provider, id: data.id || null };
  }

  throw new Error(`Unknown MAIL_PROVIDER: ${provider}`);
}

apiRoutes.post('/send-incident-report', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const {
    incidentRowId, eventId, recipients, subject, message,
    pdfBase64, pdfFilename, senderName, senderEmail,
  } = body || {};

  if (!incidentRowId) return c.json({ error: 'incidentRowId is required' }, 400);
  if (!recipients)    return c.json({ error: 'recipients is required' }, 400);
  if (!pdfBase64)     return c.json({ error: 'pdfBase64 is required' }, 400);

  const recipientList = normalizeRecipients(recipients);
  if (recipientList.length === 0) {
    return c.json({ error: 'No valid recipient email addresses' }, 400);
  }

  const finalSubject = subject || `XConnect Incident Report${eventId ? ` #${eventId}` : ''}`;
  const finalBody = composeEmailBody({ message, eventId, senderName });

  let sendResult: { provider: string; simulated?: boolean; id?: string | null };
  try {
    sendResult = await sendIncidentEmail({
      to: recipientList,
      subject: finalSubject,
      body: finalBody,
      pdfBase64,
      pdfFilename,
      senderName,
      senderEmail,
    });
  } catch (err: any) {
    return c.json({ error: `Send failed: ${err?.message || err}` }, 502);
  }

  const sentAt = new Date().toISOString();

  // Audit trail — best-effort. The email (or simulation) already happened, so
  // we still return success even if the column write fails. The client also
  // has a fallback update path when auditError is non-null.
  let auditError: string | null = null;
  try {
    const { error } = await supabase
      .from('incidents')
      .update({
        report_sent: sentAt,
        report_sent_to: recipientList.join(', '),
        report_sent_by: senderEmail || senderName || null,
        report_sent_message: message || null,
      })
      .eq('row_id', incidentRowId);
    if (error) auditError = `incidents update failed: ${error.message}`;
  } catch (err: any) {
    auditError = `audit error: ${err?.message || err}`;
  }

  return c.json({
    ok: true,
    sentAt,
    provider: sendResult.provider,
    simulated: !!sendResult.simulated,
    auditError,
  });
});
// ============ LISTS (dropdown options manager) ============
//
// The `lists` table is a multi-column lookup: each enum category lives in its
// own text column (e.g. xc_products = Product Line). Each distinct non-empty
// value sits in its own row, with the other category columns left null. The
// app builds every incident/visit dropdown from the distinct values in these
// columns. These routes let an admin add / rename / delete options.
//
// RLS on `lists` only allows SELECT for authenticated users, so all writes go
// through this service-role edge router (admin-gated via requireAdmin).
//
// CATEGORY_CONSUMERS maps a list column -> the table+column where the chosen
// value is stored as PLAIN TEXT on real records. Used to (a) count usage before
// delete and (b) cascade a rename so historical records stay consistent.
// Categories NOT listed here (failure_type, failed_component, action_status…)
// are either stored by row-id reference or have no scanned consumer, so we only
// touch the `lists` row for them.
// NOTE: 'incident_status' is intentionally NOT listed here. It is a code-driven
// workflow (New → Investigating → Root Cause Needed → Final Review → Closed)
// defined in incidentWorkflow.ts with role gating + field validation, not a
// user-editable list. It is therefore not exposed via Manage Lists.
const LIST_CATEGORIES = [
  'xc_products', 'event_category', 'firing_system', 'incident_severity',
  'xc_caused', 'vendor_caused', 'report_version',
  'field_facility', 'failure_type', 'visit_purpose', 'failed_component',
  'action_status',
];

const CATEGORY_CONSUMERS: Record<string, { table: string; column: string }> = {
  xc_products:      { table: 'incidents',   column: 'product_line' },
  event_category:   { table: 'incidents',   column: 'event_category' },
  firing_system:    { table: 'incidents',   column: 'firing_system' },
  incident_severity:{ table: 'incidents',   column: 'incident_severity' },
  xc_caused:        { table: 'incidents',   column: 'xc_caused' },
  vendor_caused:    { table: 'incidents',   column: 'vendor_caused' },
  report_version:   { table: 'incidents',   column: 'report_version' },
  field_facility:   { table: 'fieldvisits', column: 'field_or_facility' },
  visit_purpose:    { table: 'fieldvisits', column: 'visit_purpose' },
  // failure_type / failed_component are stored by row-id reference (not text)
  // and action_status has no scanned consumer here, so they are intentionally
  // omitted — rename/delete only affect the `lists` row for those.
};

function isValidCategory(cat: string): boolean {
  return LIST_CATEGORIES.includes(cat);
}

// Count how many real records currently use a given text value for a category.
// Returns 0 when the category has no scanned consumer.
async function countUsage(category: string, value: string): Promise<number> {
  const consumer = CATEGORY_CONSUMERS[category];
  if (!consumer) return 0;
  const { count, error } = await supabase
    .from(consumer.table)
    .select('*', { count: 'exact', head: true })
    .eq(consumer.column, value);
  if (error) {
    console.error(`countUsage(${category}) error:`, error.message);
    throw new Error(error.message);
  }
  return count || 0;
}

// GET all list rows (admin) — full table so the manager can group by category.
apiRoutes.get('/lists', requireAdmin, async (c) => {
  try {
    const { data, error } = await supabase.from('lists').select('*');
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data || []);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// POST add a new option: { category, value }
apiRoutes.post('/lists', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const category = String(body.category || '').trim();
    const value = String(body.value || '').trim();
    if (!isValidCategory(category)) return c.json({ error: `Unknown category "${category}"` }, 400);
    if (!value) return c.json({ error: 'Value is required' }, 400);

    // Reject duplicates (case-insensitive) within the same category.
    const { data: existing, error: exErr } = await supabase
      .from('lists').select(`row_id, ${category}`).not(category, 'is', null);
    if (exErr) return c.json({ error: exErr.message }, 500);
    const dup = (existing || []).some(
      (r: any) => String(r[category] || '').trim().toLowerCase() === value.toLowerCase()
    );
    if (dup) return c.json({ error: `"${value}" already exists in this list` }, 409);

    // For enum-backed categories, register the new label on the Postgres enum
    // type first (ALTER TYPE ... ADD VALUE IF NOT EXISTS) via the SECURITY
    // DEFINER RPC. No-op for text/non-enum categories.
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('manage_list_option', {
      p_action: 'add', p_category: category, p_new: value,
    });
    if (rpcErr) return c.json({ error: rpcErr.message }, 500);
    if (rpcRes && rpcRes.ok === false) return c.json({ error: rpcRes.error || 'add failed' }, 400);

    const rowId = 'pl_' + crypto.randomUUID().replace(/-/g, '');
    const { data, error } = await supabase
      .from('lists').insert({ row_id: rowId, [category]: value }).select().single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// PUT rename an option: { category, oldValue, newValue }
// Renames the lists row AND cascades to existing records so reports stay
// consistent. Returns how many records were updated.
apiRoutes.put('/lists/rename', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const category = String(body.category || '').trim();
    const oldValue = String(body.oldValue ?? '').trim();
    const newValue = String(body.newValue ?? '').trim();
    if (!isValidCategory(category)) return c.json({ error: `Unknown category "${category}"` }, 400);
    if (!oldValue || !newValue) return c.json({ error: 'Both old and new values are required' }, 400);
    if (oldValue === newValue) return c.json({ ok: true, updatedRecords: 0, note: 'No change' });

    // Reject collision with another existing option (case-insensitive).
    const { data: existing } = await supabase
      .from('lists').select(`row_id, ${category}`).not(category, 'is', null);
    const collision = (existing || []).some(
      (r: any) => String(r[category] || '').trim().toLowerCase() === newValue.toLowerCase()
        && String(r[category] || '').trim() !== oldValue
    );
    if (collision) return c.json({ error: `"${newValue}" already exists in this list` }, 409);

    // 1) For enum-backed categories, rename the enum label itself
    // (ALTER TYPE ... RENAME VALUE). This atomically updates EVERY consuming
    // record in one global operation — no per-row cascade needed. No-op for
    // text/non-enum categories.
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('manage_list_option', {
      p_action: 'rename', p_category: category, p_old: oldValue, p_new: newValue,
    });
    if (rpcErr) return c.json({ error: rpcErr.message }, 500);
    if (rpcRes && rpcRes.ok === false) return c.json({ error: rpcRes.error || 'rename failed' }, 400);

    // 2) update the lists row(s) holding the old value so the dropdown reflects it
    const { error: listErr } = await supabase
      .from('lists').update({ [category]: newValue }).eq(category, oldValue);
    if (listErr) return c.json({ error: listErr.message }, 500);

    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// GET usage count for a value (used by the UI before delete): ?category=&value=
apiRoutes.get('/lists/usage', requireAdmin, async (c) => {
  try {
    const category = String(c.req.query('category') || '').trim();
    const value = String(c.req.query('value') || '').trim();
    if (!isValidCategory(category)) return c.json({ error: `Unknown category "${category}"` }, 400);
    const used = await countUsage(category, value);
    return c.json({ category, value, usage: used, scanned: !!CATEGORY_CONSUMERS[category] });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// DELETE an option: { category, value }. Blocks if still in use by records.
apiRoutes.delete('/lists', requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const category = String(body.category || '').trim();
    const value = String(body.value ?? '').trim();
    if (!isValidCategory(category)) return c.json({ error: `Unknown category "${category}"` }, 400);
    if (!value) return c.json({ error: 'Value is required' }, 400);

    const used = await countUsage(category, value);
    if (used > 0) {
      return c.json({
        error: `Cannot delete "${value}" — it is still used by ${used} record${used === 1 ? '' : 's'}. Rename or reassign those records first.`,
        usage: used,
      }, 409);
    }

    const { error } = await supabase.from('lists').delete().eq(category, value);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// ===========================================================================
// USER MANAGEMENT (admin-only)
// Backed by the Supabase Auth Admin API via the service-role client. Roles are
// authoritative on app_metadata.role and mirrored to user_metadata.role for
// legacy reads (matches userRole() resolution + the /signup endpoint).
// ===========================================================================

// Normalize any requested role to a known value (least privilege default).
function normalizeUserRole(r: unknown): 'admin' | 'sqm' | 'ops' {
  const v = String(r || '').toLowerCase();
  return v === 'admin' ? 'admin' : v === 'ops' ? 'ops' : 'sqm';
}

// Resolve a Supabase auth user's effective role (app_metadata wins, then
// user_metadata), normalized. Mirrors userRole() but keeps 'ops' distinct.
function resolveRole(u: any): 'admin' | 'sqm' | 'ops' {
  const appMeta = (u?.app_metadata ?? {}) as Record<string, unknown>;
  const userMeta = (u?.user_metadata ?? {}) as Record<string, unknown>;
  return normalizeUserRole(appMeta.role ?? userMeta.role);
}

// GET /users — list all auth users with their role. Admin-only.
apiRoutes.get('/users', requireAdmin, async (c) => {
  try {
    const out: any[] = [];
    let page = 1;
    const perPage = 1000;
    for (let i = 0; i < 50; i++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) return c.json({ error: error.message }, 500);
      const users = data?.users ?? [];
      for (const u of users) {
        out.push({
          id: u.id,
          email: u.email,
          name: (u.user_metadata as any)?.name || '',
          role: resolveRole(u),
          provider: (u.app_metadata as any)?.provider || 'email',
          created_at: u.created_at,
          last_sign_in_at: (u as any).last_sign_in_at || null,
        });
      }
      if (users.length < perPage) break;
      page += 1;
    }
    out.sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));
    return c.json(out);
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// PUT /users/role — change a user's role: { userId, role }. Admin-only.
// Guard: an admin cannot demote their OWN account (prevents lockout).
apiRoutes.put('/users/role', requireAdmin, async (c) => {
  try {
    const caller = c.get('user') as any;
    const body = await c.req.json();
    const userId = String(body.userId || '').trim();
    const role = normalizeUserRole(body.role);
    if (!userId) return c.json({ error: 'userId is required' }, 400);

    if (userId === caller?.id && role !== 'admin') {
      return c.json({ error: 'You cannot remove admin access from your own account.' }, 400);
    }

    // Fetch existing metadata so we merge (preserve name etc.) rather than wipe.
    const { data: existing, error: getErr } = await supabase.auth.admin.getUserById(userId);
    if (getErr || !existing?.user) return c.json({ error: getErr?.message || 'User not found' }, 404);
    const prevUserMeta = (existing.user.user_metadata ?? {}) as Record<string, unknown>;
    const prevAppMeta = (existing.user.app_metadata ?? {}) as Record<string, unknown>;

    const { data, error } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { ...prevAppMeta, role },
      user_metadata: { ...prevUserMeta, role },
    });
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ ok: true, id: data.user?.id, role });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// DELETE /users — remove a user: { userId }. Admin-only.
// Guard: an admin cannot delete their OWN account.
apiRoutes.delete('/users', requireAdmin, async (c) => {
  try {
    const caller = c.get('user') as any;
    const body = await c.req.json();
    const userId = String(body.userId || '').trim();
    if (!userId) return c.json({ error: 'userId is required' }, 400);
    if (userId === caller?.id) {
      return c.json({ error: 'You cannot delete your own account.' }, 400);
    }
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// ============ HARDWARE INSPECTIONS (reusable hardware wear check) ============
// One inspection per field visit; each inspection has N component line items.
// Mirrors the driver-loads parent+items pattern (replace-all item sync).

const HW_INSPECTION_FIELDS = [
  'field_visit_id', 'customer', 'customer_district', 'inspector',
  'inspection_date', 'overall_status', 'notes', 'updated_by',
];
function pickHwInspection(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of HW_INSPECTION_FIELDS) if (k in body) out[k] = body[k];
  return out;
}

const HW_ITEM_CHECK_FIELDS = [
  'chk_threads', 'chk_pitting', 'chk_corrosion', 'chk_sealing_surfaces',
  'chk_makeup_feel', 'chk_bore_retainer', 'chk_general_damage',
];

// Catalog: distinct reusable mechanical hardware names from the components
// table, grouped into categories for the inspection dropdown.
apiRoutes.get("/hardware-components", async (c) => {
  try {
    const { data, error } = await supabase
      .from('components').select('failed_component');
    if (error) return c.json({ error: error.message }, 500);
    const names = Array.from(new Set(
      (data || [])
        .map((r: Record<string, unknown>) => String(r.failed_component || '').trim())
        .filter(Boolean)
    )).sort();
    return c.json({ components: names });
  } catch (error) {
    console.error('Error in hardware-components endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// List inspections (optionally filter by field_visit_id via query param).
apiRoutes.get("/hardware-inspections", async (c) => {
  try {
    const visitId = c.req.query('field_visit_id');
    let q = supabase.from('hardware_inspections').select('*')
      .order('inspection_date', { ascending: false });
    if (visitId) q = q.eq('field_visit_id', visitId);
    const { data, error } = await q;
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data || []);
  } catch (error) {
    console.error('Error in hardware-inspections list endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Convenience: the (single) inspection for a given field visit, with items.
apiRoutes.get("/hardware-inspections/by-visit/:visitId", async (c) => {
  try {
    const visitId = c.req.param('visitId');
    const { data: insp } = await supabase
      .from('hardware_inspections').select('*')
      .eq('field_visit_id', visitId)
      .order('inspection_date', { ascending: false })
      .limit(1).maybeSingle();
    if (!insp) return c.json(null);
    const { data: items } = await supabase
      .from('hardware_inspection_items').select('*')
      .eq('inspection_id', insp.row_id).order('sort_order');
    return c.json({ ...insp, items: items || [] });
  } catch (error) {
    console.error('Error in hardware-inspection by-visit endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Detail: one inspection + its items.
apiRoutes.get("/hardware-inspections/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const { data: insp, error } = await supabase
      .from('hardware_inspections').select('*').eq('row_id', id).single();
    if (error) return c.json({ error: error.message }, 500);
    const { data: items } = await supabase
      .from('hardware_inspection_items').select('*')
      .eq('inspection_id', id).order('sort_order');
    return c.json({ ...insp, items: items || [] });
  } catch (error) {
    console.error('Error in hardware-inspection detail endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.post("/hardware-inspections", async (c) => {
  try {
    const body = await c.req.json();
    const { data, error } = await supabase
      .from('hardware_inspections').insert(pickHwInspection(body)).select().single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
  } catch (error) {
    console.error('Error creating hardware inspection:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.put("/hardware-inspections/:id", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const patch = pickHwInspection(body);
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('hardware_inspections').update(patch).eq('row_id', id).select().single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
  } catch (error) {
    console.error('Error updating hardware inspection:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.delete("/hardware-inspections/:id", requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const { error } = await supabase
      .from('hardware_inspections').delete().eq('row_id', id);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting hardware inspection:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Replace the full set of component line items for an inspection.
apiRoutes.post("/hardware-inspections/:id/items", async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const { error: delErr } = await supabase
      .from('hardware_inspection_items').delete().eq('inspection_id', id);
    if (delErr) return c.json({ error: delErr.message }, 500);
    if (items.length) {
      const rows = items.map((it: Record<string, unknown>, idx: number) => {
        const row: Record<string, unknown> = {
          inspection_id: id,
          component_category: it.component_category ?? null,
          component_name: it.component_name ?? null,
          status: it.status ?? 'pass',
          note: it.note ?? null,
          sort_order: typeof it.sort_order === 'number' ? it.sort_order : idx,
        };
        for (const k of HW_ITEM_CHECK_FIELDS) row[k] = it[k] ?? false;
        return row;
      });
      const { error: insErr } = await supabase
        .from('hardware_inspection_items').insert(rows);
      if (insErr) return c.json({ error: insErr.message }, 500);
    }
    const { data: saved } = await supabase
      .from('hardware_inspection_items').select('*')
      .eq('inspection_id', id).order('sort_order');
    return c.json({ items: saved || [] });
  } catch (error) {
    console.error('Error in hardware-inspection items endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});
