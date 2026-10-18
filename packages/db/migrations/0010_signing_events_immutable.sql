-- The signing evidence trail is append-only: an event can never be changed or removed.
CREATE FUNCTION "protect_signing_event"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Signing event % of envelope % cannot be changed or deleted', OLD.seq, OLD.envelope_id USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "signing_event_immutable" BEFORE UPDATE OR DELETE ON "signing_events"
  FOR EACH ROW EXECUTE FUNCTION "protect_signing_event"();
