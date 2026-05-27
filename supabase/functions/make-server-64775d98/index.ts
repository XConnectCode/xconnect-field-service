// Entrypoint for Supabase Edge Function deployment.
// Imports the Hono app from the same folder and starts the server.
import app from "./index.tsx";

Deno.serve(app.fetch);
