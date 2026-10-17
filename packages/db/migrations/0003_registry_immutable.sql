-- Committed share register transactions never change. The only update allowed is marking one
-- reversed when its reversing transaction is entered; deleting one is never allowed.
CREATE FUNCTION "registry"."protect_committed_transaction"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('committed', 'reversed') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Committed share register transaction % cannot be deleted', OLD.seq USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT (OLD.status = 'committed' AND NEW.status = 'reversed'
            AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at')) THEN
      RAISE EXCEPTION 'Committed share register transaction % cannot be changed', OLD.seq USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "transaction_immutable" BEFORE UPDATE OR DELETE ON "registry"."transaction"
  FOR EACH ROW EXECUTE FUNCTION "registry"."protect_committed_transaction"();
