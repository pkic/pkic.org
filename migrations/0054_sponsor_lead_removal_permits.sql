-- The removal batch grants and clears permits for its exact targets.
CREATE TABLE event_sponsor_lead_removal_permits (
  target_table TEXT NOT NULL CHECK(target_table IN ('event_scan_attempts','event_sponsor_leads')),
  target_id TEXT NOT NULL,
  removal_id TEXT NOT NULL,
  PRIMARY KEY (target_table,target_id)
);
CREATE INDEX event_sponsor_lead_removal_permits_operation ON event_sponsor_lead_removal_permits(removal_id);

-- Capture closure freezes evidence metadata. The removal batch can clear
-- identifying fields on a permitted attempt, once, outside an active purge.
DROP TRIGGER evidence_capture_fence_event_scan_attempts_update;
CREATE TRIGGER evidence_capture_fence_event_scan_attempts_update BEFORE UPDATE ON event_scan_attempts
WHEN EXISTS (
  SELECT 1 FROM event_evidence_retention_state state WHERE state.event_id IN (OLD.event_id,NEW.event_id)
  AND (state.active_run_id IS NOT NULL OR (state.capture_closed_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM event_sponsor_lead_removal_permits permit
    WHERE permit.target_table='event_scan_attempts' AND permit.target_id=OLD.id
      AND permit.removal_id=NEW.sponsor_lead_removal_id
      AND OLD.action='lead' AND OLD.outcome='eligible' AND OLD.user_id IS NOT NULL
      AND OLD.sponsor_lead_removed_at IS NULL AND NEW.sponsor_lead_removed_at IS NOT NULL
      AND NEW.user_id IS NULL AND NEW.badge_id IS NULL
      AND NEW.scanned_value IS NULL AND NEW.scanned_value_truncated IS NULL
      AND NEW.request_hash IS NOT OLD.request_hash
  )))
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;

CREATE TRIGGER evidence_capture_fence_event_scan_attempts_metadata
BEFORE UPDATE OF id,event_id,occurrence_id,room_id,sponsor_id,operator_user_id,device_id,operation_id,
  outcome,reason,exception_reason,action,observed_at,created_at,capture_day_date,capture_time_zone,
  capture_publication_revision,capture_context_source,admission_decision,capture_method,attendance_point_kind,
  attendee_standing,session_booked ON event_scan_attempts
WHEN EXISTS (SELECT 1 FROM event_evidence_retention_state state
  WHERE state.event_id IN (OLD.event_id,NEW.event_id) AND state.capture_closed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;

-- A sponsor removal permit is valid outside a purge. During a purge only
-- the existing run-bound permit can authorize deletion.
DROP TRIGGER evidence_capture_fence_event_sponsor_leads_delete;
CREATE TRIGGER evidence_capture_fence_event_sponsor_leads_delete BEFORE DELETE ON event_sponsor_leads
WHEN EXISTS (
  SELECT 1 FROM event_evidence_retention_state state WHERE state.event_id=OLD.event_id AND (
    (state.active_run_id IS NULL AND state.capture_closed_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM event_sponsor_lead_removal_permits permit
      WHERE permit.target_table='event_sponsor_leads' AND permit.target_id=OLD.id
    ))
    OR (state.active_run_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM event_evidence_retention_delete_permits permit
      JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=state.event_id
      WHERE permit.event_id=state.event_id AND permit.run_id=state.active_run_id
        AND permit.table_name='event_sponsor_leads' AND permit.row_id=OLD.rowid
        AND run.status='running' AND run.phase=permit.table_name
        AND NOT EXISTS (SELECT 1 FROM event_evidence_retention_chunks consumed
          WHERE consumed.operation_id=permit.chunk_operation_id)
    ))
  )
)
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
