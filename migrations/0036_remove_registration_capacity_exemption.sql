-- Role admission is resolved from active event roles when a capacity decision is made.
-- Deploy code that no longer reads these columns before applying this migration.
DROP TRIGGER trg_registration_capacity_update_revision;

ALTER TABLE registrations DROP COLUMN capacity_exempt_in_person;
ALTER TABLE registrations DROP COLUMN capacity_exempt_reason;

CREATE TRIGGER trg_registration_capacity_update_revision
AFTER UPDATE OF status ON registrations
FOR EACH ROW
WHEN OLD.status IS NOT NEW.status
BEGIN
  UPDATE event_days SET capacity_revision = capacity_revision + 1 WHERE event_id IN (OLD.event_id, NEW.event_id);
END;
