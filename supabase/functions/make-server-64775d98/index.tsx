import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";
import { createClient } from "npm:@supabase/supabase-js@2.49.2";
import { apiRoutes } from "./api-routes.tsx";
import { aiAssistRoutes } from "./ai-assist.tsx";
import { initializeIncidentImagesBucket } from "./upload-handler.tsx";
import { adminExists, getUserFromRequest } from "./auth-helpers.tsx";

const app = new Hono();

// Initialize Supabase client with service role key
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

// Log environment check
console.log('Edge Function initialized with project:', Deno.env.get('SUPABASE_URL')?.includes('gbllxumuogsncoiaksum') ? 'CORRECT' : 'MISMATCH');
console.log('🔄 Redeployed to sync with current JWT secret - ', new Date().toISOString());

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Health check endpoint
app.get("/make-server-64775d98/health", (c) => {
  return c.json({ status: "ok" });
});

// Mount API routes for Supabase tables (routes are prefixed with /make-server-64775d98)
app.route('/make-server-64775d98', apiRoutes);

// AI incident-assistant proxy (provider/model are env-selected; see ai-assist.tsx)
app.route('/make-server-64775d98', aiAssistRoutes);

// Get database schema information
app.get("/make-server-64775d98/schema", async (c) => {
  try {
    const schema: any = {
      tables: [],
      columns: {},
      samples: {}
    };

    // List of common table names to try
    const possibleTables = [
      'customers',
      'districts', 
      'field_visits',
      'fieldvisits',
      'incidents',
      'panels',
      'xfire_panels',
      'sales',
      'barrel_sales',
      'stage_sales',
      'users',
      'kv_store_64775d98'
    ];

    // Try to query each table
    for (const tableName of possibleTables) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .limit(1);

        if (!error && data) {
          schema.tables.push(tableName);
          
          // Get column names from the sample data
          if (data.length > 0) {
            const sampleRow = data[0];
            schema.columns[tableName] = Object.keys(sampleRow).map(key => ({
              name: key,
              type: typeof sampleRow[key],
              sample: sampleRow[key]
            }));
            schema.samples[tableName] = sampleRow;
          }
        }
      } catch (err) {
        // Table doesn't exist, skip it
        continue;
      }
    }

    // Also try to get the actual list from pg_catalog
    try {
      const { data: pgTables, error: pgError } = await supabase
        .from('pg_tables')
        .select('tablename')
        .eq('schemaname', 'public');
      
      if (!pgError && pgTables) {
        const pgTableNames = pgTables.map((t: any) => t.tablename);
        schema.allTables = pgTableNames;
      }
    } catch (err) {
      // Ignore if we can't access pg_tables
    }

    return c.json(schema);
  } catch (error) {
    console.error('Error fetching schema:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// New endpoint to diagnose row_id column configuration
app.get("/make-server-64775d98/diagnose-row-id", async (c) => {
  try {
    // Query information_schema to get column details
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          table_name,
          column_name,
          data_type,
          column_default,
          is_nullable,
          character_maximum_length,
          numeric_precision
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND column_name = 'row_id'
        AND table_name IN ('customers', 'districts', 'fieldvisits', 'incidents', 'panels')
        ORDER BY table_name;
      `
    });

    if (error) {
      // If RPC doesn't exist, try direct query
      console.log('RPC exec_sql not available, trying alternative method');
      
      // Return instruction for manual check
      return c.json({
        message: 'Please run this SQL in your Supabase SQL Editor:',
        sql: `
SELECT 
  table_name,
  column_name,
  data_type,
  column_default,
  is_nullable,
  character_maximum_length,
  numeric_precision
FROM information_schema.columns
WHERE table_schema = 'public'
AND column_name = 'row_id'
AND table_name IN ('customers', 'districts', 'fieldvisits', 'incidents', 'panels')
ORDER BY table_name;
        `,
        recommendation: 'Copy the results and share them to get the exact fix needed'
      });
    }

    return c.json({ diagnosis: data });
  } catch (error) {
    console.error('Error diagnosing row_id:', error);
    return c.json({ 
      error: String(error),
      fallbackInstructions: {
        message: 'Please run this SQL in your Supabase SQL Editor to diagnose:',
        sql: `
SELECT 
  table_name,
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND column_name = 'row_id'
AND table_name IN ('customers', 'districts', 'fieldvisits', 'incidents', 'panels')
ORDER BY table_name;
        `
      }
    }, 500);
  }
});

// Get fresh anon key - helps when the frontend key is stale
app.get("/make-server-64775d98/config", (c) => {
  // Log the environment variables to help debug JWT issues
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  
  console.log('📝 Environment check:');
  console.log('  SUPABASE_URL:', supabaseUrl);
  console.log('  ANON_KEY (first 20 chars):', anonKey.substring(0, 20));
  console.log('  JWT_SECRET exists:', Deno.env.get('SUPABASE_JWT_SECRET') ? 'YES' : 'NO');
  
  return c.json({ 
    anonKey: anonKey,
    url: supabaseUrl,
    jwtSecretConfigured: !!Deno.env.get('SUPABASE_JWT_SECRET')
  });
});

// ============ AUTHENTICATION ROUTES ============

// Sign in endpoint - bypasses Supabase JWT validation
app.post("/make-server-64775d98/signin", async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    // Create a Supabase client with anon key for this request
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
    
    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.log(`Error signing in: ${error.message}`);
      return c.json({ error: error.message }, 401);
    }

    if (!data.session) {
      return c.json({ error: 'No session returned' }, 401);
    }

    return c.json({ 
      access_token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata.name || '',
        role: data.user.user_metadata.role || 'sqm',
      }
    });
  } catch (error) {
    console.log(`Signin error: ${error}`);
    return c.json({ error: 'Failed to sign in' }, 500);
  }
});

// Sign up new user. Admin role is gated:
//   - Public callers can create the very first admin (bootstrap).
//   - After at least one admin exists, only an already-authenticated admin
//     may create another admin or any other user.
// Roles are stored on user_metadata.role; this endpoint normalizes any
// unknown role to "sqm" so the client can't smuggle privileged values.
app.post("/make-server-64775d98/signup", async (c) => {
  try {
    const { email, password, name, role } = await c.req.json();
    const requestedRole: 'admin' | 'sqm' = role === 'admin' ? 'admin' : 'sqm';

    const callingUser = await getUserFromRequest(c);
    const hasAdmin = await adminExists();

    if (requestedRole === 'admin') {
      // After bootstrap, only an existing admin may mint another admin.
      if (hasAdmin && callingUser?.role !== 'admin') {
        return c.json({ error: 'Admin account already exists' }, 403);
      }
    } else {
      // Creating any non-admin user requires an authenticated admin once
      // setup is complete. Pre-bootstrap, only admin creation is allowed.
      if (!hasAdmin) {
        return c.json({ error: 'Initial setup must create an admin' }, 403);
      }
      if (callingUser?.role !== 'admin') {
        return c.json({ error: 'Forbidden' }, 403);
      }
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name, role: requestedRole },
      // Automatically confirm the user's email since an email server hasn't been configured.
      email_confirm: true
    });

    if (error) {
      console.log(`Error creating user during signup: ${error.message}`);
      return c.json({ error: error.message }, 400);
    }

    return c.json({ user: data.user });
  } catch (error) {
    console.log(`Signup error: ${error}`);
    return c.json({ error: 'Failed to create user' }, 500);
  }
});

// Public endpoint: does an admin already exist? Used by the UI to decide
// whether /setup should be reachable. Intentionally returns only a boolean
// so it leaks no user details.
app.get("/make-server-64775d98/admin-exists", async (c) => {
  try {
    const exists = await adminExists();
    return c.json({ exists });
  } catch (error) {
    console.log(`admin-exists error: ${error}`);
    // Fail closed for the UI: if we can't determine state, claim an admin
    // exists so /setup stays locked.
    return c.json({ exists: true });
  }
});

// Sign out endpoint
app.post("/make-server-64775d98/signout", async (c) => {
  // Note: In a stateless JWT system, sign out is handled client-side
  // by deleting the access token. This endpoint exists for completeness.
  return c.json({ success: true });
});

// Get current session - validates the access token
app.get("/make-server-64775d98/session", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'No authorization header' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
    
    const { data: { user }, error } = await authClient.auth.getUser(token);

    if (error || !user) {
      console.log(`Session validation error: ${error?.message}`);
      return c.json({ error: 'Invalid session' }, 401);
    }

    return c.json({ 
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata.name || '',
        role: user.user_metadata.role || 'sqm',
      }
    });
  } catch (error) {
    console.log(`Session check error: ${error}`);
    return c.json({ error: 'Failed to validate session' }, 500);
  }
});

// Initialize Supabase Storage bucket for incident images on startup
initializeIncidentImagesBucket().then(() => {
  console.log('✅ Incident images bucket initialized');
}).catch((error) => {
  console.error('⚠️ Failed to initialize incident images bucket:', error);
});

// Start the server when run directly (local dev). When imported as a module
// for an Edge Function deployment we should not call Deno.serve automatically.
if (import.meta.main) {
  Deno.serve(app.fetch);
}

// Export the app for use by function wrappers or tests
export default app;