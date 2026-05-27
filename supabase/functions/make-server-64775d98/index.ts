// Wrapper entrypoint for Supabase Edge Function deployment.
// Imports the Hono app (without starting a server) and exports its fetch
// handler as the function entrypoint.
import app from "../server/index.tsx";

export default app.fetch;
