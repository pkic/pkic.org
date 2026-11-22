-- Keep the scanner operation for retry safety, but unlink a withdrawn lead scan
-- from the attendee and badge. Audit entries identify the operator and action.
ALTER TABLE event_scan_attempts ADD COLUMN sponsor_lead_removed_at TEXT;
ALTER TABLE event_scan_attempts ADD COLUMN sponsor_lead_removal_id TEXT;
CREATE INDEX event_scan_attempts_lead_removal ON event_scan_attempts(sponsor_lead_removal_id)
  WHERE sponsor_lead_removal_id IS NOT NULL;

-- A closed evidence capture blocks ordinary edits. A lead privacy removal may
-- clear only its attendee fields; an active retention run still blocks writes.
DROP TRIGGER evidence_capture_fence_event_scan_attempts_update;
CREATE TRIGGER evidence_capture_fence_event_scan_attempts_update BEFORE UPDATE ON event_scan_attempts
WHEN EXISTS (SELECT 1 FROM event_evidence_retention_state retention
  WHERE retention.event_id IN (OLD.event_id,NEW.event_id) AND retention.active_run_id IS NOT NULL)
  OR (EXISTS (SELECT 1 FROM event_evidence_retention_state retention
    WHERE retention.event_id IN (OLD.event_id,NEW.event_id) AND retention.capture_closed_at IS NOT NULL)
    AND NOT (
      OLD.action='lead' AND OLD.outcome='eligible' AND OLD.user_id IS NOT NULL
      AND OLD.sponsor_lead_removed_at IS NULL AND NEW.sponsor_lead_removed_at IS NOT NULL
      AND NEW.sponsor_lead_removal_id IS NOT NULL
      AND NEW.user_id IS NULL AND NEW.badge_id IS NULL
      AND NEW.scanned_value IS NULL AND NEW.scanned_value_truncated IS NULL
      AND NEW.request_hash IS NOT OLD.request_hash
      AND NEW.id IS OLD.id AND NEW.event_id IS OLD.event_id
      AND NEW.occurrence_id IS OLD.occurrence_id AND NEW.room_id IS OLD.room_id
      AND NEW.sponsor_id IS OLD.sponsor_id AND NEW.operator_user_id IS OLD.operator_user_id
      AND NEW.device_id IS OLD.device_id AND NEW.operation_id IS OLD.operation_id
      AND NEW.outcome IS OLD.outcome AND NEW.reason IS OLD.reason
      AND NEW.exception_reason IS OLD.exception_reason AND NEW.action IS OLD.action
      AND NEW.observed_at IS OLD.observed_at AND NEW.created_at IS OLD.created_at
      AND NEW.capture_day_date IS OLD.capture_day_date
      AND NEW.capture_time_zone IS OLD.capture_time_zone
      AND NEW.capture_publication_revision IS OLD.capture_publication_revision
      AND NEW.capture_context_source IS OLD.capture_context_source
      AND NEW.admission_decision IS OLD.admission_decision
      AND NEW.capture_method IS OLD.capture_method
      AND NEW.attendance_point_kind IS OLD.attendance_point_kind
      AND NEW.attendee_standing IS OLD.attendee_standing
      AND NEW.session_booked IS OLD.session_booked
    ))
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;

-- Once every capture is removed, the shared lead can be erased even after
-- evidence capture closes. The use case supplies the guarded audit entry.
DROP TRIGGER evidence_capture_fence_event_sponsor_leads_delete;
CREATE TRIGGER evidence_capture_fence_event_sponsor_leads_delete BEFORE DELETE ON event_sponsor_leads
WHEN EXISTS (SELECT 1 FROM event_evidence_retention_state retention
  WHERE retention.event_id=OLD.event_id
    AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))
  AND NOT (
    EXISTS (SELECT 1 FROM event_evidence_retention_state retention
      WHERE retention.event_id=OLD.event_id AND retention.capture_closed_at IS NOT NULL
        AND retention.active_run_id IS NULL)
    AND
    NOT EXISTS (SELECT 1 FROM event_scan_attempts attempt
      WHERE attempt.event_id=OLD.event_id AND attempt.sponsor_id=OLD.sponsor_id
        AND attempt.user_id=OLD.user_id AND attempt.action='lead'
        AND attempt.outcome='eligible' AND attempt.sponsor_lead_removed_at IS NULL)
    AND EXISTS (SELECT 1 FROM audit_log audit WHERE audit.entity_type='event_sponsor_lead'
      AND audit.entity_id=OLD.id AND audit.action='sponsor_lead_captures_removed')
  )
  AND NOT EXISTS (
    SELECT 1 FROM event_evidence_retention_delete_permits permit
    JOIN event_evidence_retention_runs run ON run.id=permit.run_id AND run.event_id=permit.event_id
    JOIN event_evidence_retention_state guard_state ON guard_state.event_id=permit.event_id
      AND guard_state.active_run_id=run.id
    WHERE permit.table_name='event_sponsor_leads' AND permit.row_id=OLD.rowid
      AND run.status='running' AND run.phase=permit.table_name
      AND NOT EXISTS (SELECT 1 FROM event_evidence_retention_chunks consumed
        WHERE consumed.operation_id=permit.chunk_operation_id)
  )
BEGIN SELECT RAISE(ABORT,'EVENT_EVIDENCE_CAPTURE_CLOSED'); END;
