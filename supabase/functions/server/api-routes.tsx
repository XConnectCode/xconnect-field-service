import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2.49.2";
import { uploadIncidentImage, listIncidentImages, deleteIncidentImage, uploadImage, listImagesForRecord, deleteImageById } from './upload-handler.tsx';
import { generateIncidentReportPDF } from './pdf-generator.tsx';
import { requireAdmin } from './auth-helpers.tsx';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export const apiRoutes = new Hono();

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

apiRoutes.get("/fieldvisits", async (c) => {
  try {
    const { data, error } = await supabase
      .from('fieldvisits')
      .select('*')
      .order('arrival_date', { ascending: false });

    if (error) {
      console.error('Error fetching field visits:', error);
      return c.json({ error: error.message }, 500);
    }

    // Enrich with customer and district names
    const enrichedData = await Promise.all((data || []).map(async (visit) => {
      let customerName = null;
      let districtName = null;

      if (visit.customer) {
        const { data: customer } = await supabase
          .from('customers')
          .select('customer')
          .eq('row_id', visit.customer)
          .single();
        customerName = customer?.customer;
      }

      if (visit.customer_district) {
        const { data: district } = await supabase
          .from('districts')
          .select('customer_district')
          .eq('row_id', visit.customer_district)
          .single();
        districtName = district?.customer_district;
      }

      return {
        ...visit,
        customerName,
        districtName
      };
    }));

    return c.json(enrichedData);
  } catch (error) {
    console.error('Error in field visits endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.post("/fieldvisits", async (c) => {
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
        xc_rep: body.xc_rep
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating field visit:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in create field visit endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

apiRoutes.put("/fieldvisits/:id", async (c) => {
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
        xc_rep: body.xc_rep
      })
      .eq('row_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating field visit:', error);
      return c.json({ error: error.message }, 500);
    }

    return c.json(data);
  } catch (error) {
    console.error('Error in update field visit endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

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
    // Fetch barrels data
    const { data: barrelsData, error: barrelsError } = await supabase
      .from('barrels_sold')
      .select('*');

    if (barrelsError) {
      console.error('Error fetching barrels:', barrelsError);
      return c.json({ error: barrelsError.message }, 500);
    }

    // Fetch stages data
    const { data: stagesData, error: stagesError } = await supabase
      .from('stages')
      .select('*');

    if (stagesError) {
      console.error('Error fetching stages:', stagesError);
      return c.json({ error: stagesError.message }, 500);
    }

    // Combine data by date and customer/district
    const combinedMap = new Map();

    // Process barrels data
    (barrelsData || []).forEach(barrel => {
      const key = `${barrel.date}-${barrel.customer}-${barrel.customer_district}`;
      if (!combinedMap.has(key)) {
        combinedMap.set(key, {
          id: barrel.row_id,
          weekEnding: barrel.date,
          customer: barrel.customer,
          customerId: barrel.customer,
          customerName: barrel.customer,
          districtId: barrel.customer_district,
          districtName: barrel.customer_district,
          barrels: parseInt(barrel.quantity) || 0,
          stages: 0,
          notes: null,
          enteredBy: null
        });
      } else {
        const existing = combinedMap.get(key);
        existing.barrels = parseInt(barrel.quantity) || 0;
      }
    });

    // Process stages data
    (stagesData || []).forEach(stage => {
      const key = `${stage.date}-${stage.customer}-${stage.customer_district}`;
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
          stages: parseInt(stage.quantity) || 0,
          notes: null,
          enteredBy: null
        });
      } else {
        const existing = combinedMap.get(key);
        existing.stages = parseInt(stage.quantity) || 0;
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
    
    // Insert into barrels_sold table if barrels > 0
    if (body.barrels && body.barrels > 0) {
      const { error: barrelsError } = await supabase
        .from('barrels_sold')
        .insert({
          date: body.weekEnding,
          quantity: body.barrels.toString(),
          customer_district: districtName,
          customer: customerName,
          product_line: 'Perforating Guns'
        });

      if (barrelsError) {
        console.error('Error creating barrels record:', barrelsError);
        return c.json({ error: barrelsError.message }, 500);
      }
    }

    // Insert into stages table if stages > 0
    if (body.stages && body.stages > 0) {
      const { error: stagesError } = await supabase
        .from('stages')
        .insert({
          date: body.weekEnding,
          quantity: body.stages.toString(),
          customer_district: districtName,
          customer: customerName,
          item: 'Stage'
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
        'serial#': body['serial#'],
        shootingfw: body.shootingfw,
        wl_controlfw: body.wl_controlfw,
        loggingfw: body.loggingfw,
        'gui#': body['gui#'],
        surfacefw: body.surfacefw,
        received_date: body.received_date,
        xc_base: body.xc_base,
        panel_status: body.panel_status,
        'unit#': body['unit#'],
        'so#': body['so#'],
        date_updated: body.date_updated,
        tracking_info: body.tracking_info,
        comments: body.comments,
        verified: body.verified,
        rma: body.rma,
        'spare?': body['spare?'],
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
        'serial#': body['serial#'],
        shootingfw: body.shootingfw,
        wl_controlfw: body.wl_controlfw,
        loggingfw: body.loggingfw,
        'gui#': body['gui#'],
        surfacefw: body.surfacefw,
        received_date: body.received_date,
        xc_base: body.xc_base,
        panel_status: body.panel_status,
        'unit#': body['unit#'],
        'so#': body['so#'],
        date_updated: body.date_updated,
        tracking_info: body.tracking_info,
        comments: body.comments,
        verified: body.verified,
        rma: body.rma,
        'spare?': body['spare?'],
        customer_district: body.customer_district,
        operating_company: body.operating_company,
        customer: body.customer,
        updated_by: body.updated_by,
        activity: body.activity
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
    
    // Get sales data (barrels from barrels_sold table and stages from stages table) - use NAMES, not row_ids
    const { data: barrelsData, error: barrelsError } = await supabase
      .from('barrels_sold')
      .select('quantity')
      .eq('customer', customerName)
      .eq('customer_district', districtName);
    
    if (barrelsError) {
      console.error('Error fetching barrels:', barrelsError);
    }
    
    const { data: stagesData, error: stagesError } = await supabase
      .from('stages')
      .select('quantity')
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
    
    // Get sales data (barrels from barrels_sold table and stages from stages table) - use customer NAME, not row_id
    const { data: barrelsData, error: barrelsError } = await supabase
      .from('barrels_sold')
      .select('quantity')
      .eq('customer', customerName);
    
    if (barrelsError) {
      console.error('Error fetching barrels:', barrelsError);
    }
    
    const { data: stagesData, error: stagesError } = await supabase
      .from('stages')
      .select('quantity')
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
    
    // Get all sales data (barrels from barrels_sold table and stages from stages table)
    const { data: barrelsData, error: barrelsError } = await supabase
      .from('barrels_sold')
      .select('quantity');
    
    if (barrelsError) {
      console.error('Error fetching barrels:', barrelsError);
    }
    console.log(`Barrels rows: ${barrelsData?.length || 0}`);
    
    const { data: stagesData, error: stagesError } = await supabase
      .from('stages')
      .select('quantity');
    
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
      .from('barrels_sold')
      .select('quantity, date, customer_district, customer')
      .eq('customer', customerName);
    
    if (barrelsError) {
      console.error('Error fetching barrels for customer:', barrelsError);
    }
    
    console.log(`Customer ${customerName} (ID: ${id}) - Barrels data count: ${barrelsData?.length || 0}`);
    
    const { data: stagesData, error: stagesError } = await supabase
      .from('stages')
      .select('quantity, date, customer_district, customer')
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
      .from('barrels_sold')
      .select('quantity, date')
      .eq('customer_district', districtName);
    
    const { data: stagesData } = await supabase
      .from('stages')
      .select('quantity, date')
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
      .from('stages')
      .select('*', { count: 'exact', head: true });
    
    const { count: barrelsCount } = await supabase
      .from('barrels_sold')
      .select('*', { count: 'exact', head: true });
    
    // Fetch all stages data with pagination to sum quantities
    let allStagesData: any[] = [];
    let stagesPage = 0;
    const pageSize = 1000;
    while (true) {
      const { data } = await supabase
        .from('stages')
        .select('quantity')
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
        .from('barrels_sold')
        .select('quantity')
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