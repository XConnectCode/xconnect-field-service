-- migration_grants.sql
-- Applied after schema + data load on eXodus (fst_app schema)

SET search_path = fst_app;
GRANT USAGE  ON SCHEMA fst_app TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA fst_app TO anon, authenticated;
GRANT ALL    ON ALL TABLES IN SCHEMA fst_app TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA fst_app GRANT ALL    ON TABLES TO service_role;
