-- Database-level immutability for the append-only tables (Invariants I-9, I-10).
-- The application layer already only ever INSERTs into these (AuditService.write,
-- the period-snapshot and stock-valuation writers); this migration adds the
-- DB-level guarantee that holds even if a future code path or a direct
-- connection tries to mutate them. It also introduces the non-owner runtime role
-- the application connects as, so the REVOKEs below actually bite (they do
-- nothing while connected as the table owner).
--
-- This migration is RUN BY THE OWNER (the role prisma migrates as). The app
-- RUNTIME connects as enviable_app; migrations keep running as the owner (a
-- non-owner cannot create tables). See the connection-string note at the end.
--
-- Two layers, each doing the one thing it is good at:
--   1. REVOKE: enviable_app simply has no UPDATE/DELETE privilege on the three
--      immutable tables, so the database rejects the statement before any
--      trigger fires. This is the primary guarantee.
--   2. A block-only trigger that RAISEs on UPDATE/DELETE: defence in depth for
--      any path that somehow holds more privilege (it fires regardless of role).
-- Neither layer logs. RECORDING a blocked attempt as a DELETE_BLOCKED audit
-- entry is an APPLICATION-layer concern, deferred: when a mutation is rejected,
-- the app catches the error and writes a DELETE_BLOCKED entry via the normal
-- AuditService.write INSERT path (a separate, successful transaction that
-- commits cleanly, and carries the request context the database does not have).
-- This deliberately avoids dblink and autonomous-commit machinery in the trigger.

-- ---------------------------------------------------------------------------
-- 1. Non-owner application role. Created without a usable password here; the
-- operator sets a real one (see the note at the end) and never commits it.
-- LOGIN so the app can connect as it. NOT a superuser, NOT the table owner, so
-- the REVOKEs and the trigger below constrain it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'enviable_app') THEN
    CREATE ROLE enviable_app LOGIN PASSWORD 'CHANGE_ME_SET_BY_OPERATOR';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Grant the runtime role full DML on operational tables, then take back
-- UPDATE/DELETE on the three immutable tables. ALTER DEFAULT PRIVILEGES covers
-- tables a future migration adds (still created by the owner).
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO enviable_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO enviable_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO enviable_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO enviable_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO enviable_app;

-- The immutable three: SELECT and INSERT only (append-only). Revoke the rest.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log_entries     FROM enviable_app;
REVOKE UPDATE, DELETE, TRUNCATE ON period_snapshots       FROM enviable_app;
REVOKE UPDATE, DELETE, TRUNCATE ON stock_valuation_lines  FROM enviable_app;

-- ---------------------------------------------------------------------------
-- 3. Block-only trigger. On any attempted UPDATE or DELETE it RAISEs and the
-- statement fails. No INSERT, no dblink, no autonomous commit: the trigger only
-- blocks. It fires for every role (defence in depth behind the REVOKE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enviable_block_immutable_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
AS $func$
BEGIN
  RAISE EXCEPTION
    '% is append-only (Invariants I-9/I-10): % is not permitted',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$func$;

DROP TRIGGER IF EXISTS enviable_immutable_block ON audit_log_entries;
CREATE TRIGGER enviable_immutable_block
  BEFORE UPDATE OR DELETE ON audit_log_entries
  FOR EACH ROW EXECUTE FUNCTION enviable_block_immutable_mutation();

DROP TRIGGER IF EXISTS enviable_immutable_block ON period_snapshots;
CREATE TRIGGER enviable_immutable_block
  BEFORE UPDATE OR DELETE ON period_snapshots
  FOR EACH ROW EXECUTE FUNCTION enviable_block_immutable_mutation();

DROP TRIGGER IF EXISTS enviable_immutable_block ON stock_valuation_lines;
CREATE TRIGGER enviable_immutable_block
  BEFORE UPDATE OR DELETE ON stock_valuation_lines
  FOR EACH ROW EXECUTE FUNCTION enviable_block_immutable_mutation();

-- ---------------------------------------------------------------------------
-- OPERATOR STEPS (run once, outside this migration, with the real values):
--
--   -- give the runtime role a real password (never committed):
--   ALTER ROLE enviable_app PASSWORD '<strong-secret>';
--
--   -- then point the APP runtime at the non-owner role (do NOT change the URL
--   -- prisma migrates with; migrations must keep running as the owner):
--   DATABASE_URL="postgresql://enviable_app:<secret>@<host>:<port>/enviable?schema=public"
--
-- Local dev keeps working unchanged until the operator switches DATABASE_URL.
-- In production the app connects as enviable_app so the immutability is enforced
-- against the running application; locally you may keep connecting as the owner
-- (the REVOKEs simply do not bite on a single-user dev database).
-- ---------------------------------------------------------------------------
