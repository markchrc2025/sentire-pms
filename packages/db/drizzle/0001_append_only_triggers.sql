-- Append-only tables: reject UPDATE and DELETE at the database level (System Design NFR-07, CLAUDE.md rule 6).
CREATE OR REPLACE FUNCTION pms_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION pms_reject_change();
--> statement-breakpoint
-- Outbox rows may only change acked_at (set once, when the other side acknowledges).
CREATE OR REPLACE FUNCTION pms_outbox_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbox_events rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.seq IS DISTINCT FROM OLD.seq
     OR NEW.entity IS DISTINCT FROM OLD.entity OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.op IS DISTINCT FROM OLD.op OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.property_id IS DISTINCT FROM OLD.property_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'outbox_events rows are immutable except acked_at' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.acked_at IS NOT NULL AND NEW.acked_at IS DISTINCT FROM OLD.acked_at THEN
    RAISE EXCEPTION 'outbox_events.acked_at can only be set once' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER outbox_events_guard
  BEFORE UPDATE OR DELETE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION pms_outbox_guard();
