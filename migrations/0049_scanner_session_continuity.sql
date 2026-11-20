-- An enrolled scanner may resume its original sequence after a server-side close.
-- The existing evidence fence still forbids updates once event capture or purging closes.
DROP TRIGGER event_scanner_device_session_closing_immutable;
CREATE TRIGGER event_scanner_device_session_closing_immutable BEFORE UPDATE ON event_scanner_device_sessions
WHEN OLD.high_water_sequence IS NOT NULL AND (
 NEW.high_water_sequence IS NOT OLD.high_water_sequence OR NEW.closing_operation_id IS NOT OLD.closing_operation_id
 OR NEW.closing_declared_at IS NOT OLD.closing_declared_at)
 AND NOT (NEW.high_water_sequence IS NULL AND NEW.closing_operation_id IS NULL
   AND NEW.closing_declared_at IS NULL AND NEW.closed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'SCANNER_DEVICE_SESSION_CLOSING_IMMUTABLE'); END;
DROP TRIGGER event_scanner_device_session_terminal;
CREATE TRIGGER event_scanner_device_session_terminal BEFORE UPDATE ON event_scanner_device_sessions
WHEN OLD.closed_at IS NOT NULL AND NEW.closed_at IS NOT OLD.closed_at
 AND NOT (NEW.high_water_sequence IS NULL AND NEW.closing_operation_id IS NULL
   AND NEW.closing_declared_at IS NULL AND NEW.closed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'SCANNER_DEVICE_SESSION_CLOSED'); END;
