/**
 * Centralized Supabase client instance
 * Connected to: eXodus project (qbexqpvzmssmifimlfos) — fst_app schema
 * FST APP prod fallback: gbllxumuogsncoiaksum / public schema
 *
 * Import this shared instance instead of creating new clients to avoid
 * multiple GoTrueClient instance warnings.
 */
import { createClient } from '@supabase/supabase-js';

// eXodus project — all feature tables live in fst_app schema here
const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || 'qbexqpvzmssmifimlfos';
const publicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFiZXhxcHZ6bXNzbWlmaW1sZm9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzI1ODMsImV4cCI6MjA5MjM0ODU4M30.vPy_7hRirP36Qta_Q5Qw0Z6hSkgEOJwUAVp0AtXqBQQ';

export const supabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey,
  { db: { schema: 'fst_app' } }
);

