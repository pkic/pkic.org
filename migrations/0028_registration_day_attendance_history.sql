-- Migration 0028: Consolidate attendance history into a single table

ALTER TABLE registration_attendance_history ADD COLUMN event_day_id TEXT;

CREATE INDEX IF NOT EXISTS idx_reg_att_hist_reg_day
  ON registration_attendance_history(registration_id, event_day_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_reg_att_hist_changed_at
  ON registration_attendance_history(changed_at);

-- Backfill legacy event-level history rows to day-level history rows.
-- Strategy (best effort):
-- 1) Fan out to all currently selected registration days when available.
-- 2) Otherwise, map to the only day for single-day events.
-- 3) Remove legacy rows that were successfully mapped.

INSERT INTO registration_attendance_history (
  id,
  registration_id,
  event_day_id,
  from_type,
  to_type,
  changed_by,
  changed_at
)
SELECT
  lower(hex(randomblob(16))) AS id,
  h.registration_id,
  rda.event_day_id,
  COALESCE(h.from_type, 'not_attending') AS from_type,
  COALESCE(h.to_type, 'not_attending') AS to_type,
  h.changed_by,
  h.changed_at
FROM registration_attendance_history h
JOIN registration_day_attendance rda
  ON rda.registration_id = h.registration_id
WHERE h.event_day_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM registration_attendance_history hx
    WHERE hx.registration_id = h.registration_id
      AND hx.event_day_id = rda.event_day_id
      AND COALESCE(hx.from_type, 'not_attending') = COALESCE(h.from_type, 'not_attending')
      AND COALESCE(hx.to_type, 'not_attending') = COALESCE(h.to_type, 'not_attending')
      AND hx.changed_by = h.changed_by
      AND hx.changed_at = h.changed_at
  );

INSERT INTO registration_attendance_history (
  id,
  registration_id,
  event_day_id,
  from_type,
  to_type,
  changed_by,
  changed_at
)
SELECT
  lower(hex(randomblob(16))) AS id,
  h.registration_id,
  eds.day_id,
  COALESCE(h.from_type, 'not_attending') AS from_type,
  COALESCE(h.to_type, 'not_attending') AS to_type,
  h.changed_by,
  h.changed_at
FROM registration_attendance_history h
JOIN registrations r
  ON r.id = h.registration_id
JOIN (
  SELECT event_id, MIN(id) AS day_id
  FROM event_days
  GROUP BY event_id
  HAVING COUNT(*) = 1
) eds
  ON eds.event_id = r.event_id
WHERE h.event_day_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM registration_day_attendance rda
    WHERE rda.registration_id = h.registration_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM registration_attendance_history hx
    WHERE hx.registration_id = h.registration_id
      AND hx.event_day_id = eds.day_id
      AND COALESCE(hx.from_type, 'not_attending') = COALESCE(h.from_type, 'not_attending')
      AND COALESCE(hx.to_type, 'not_attending') = COALESCE(h.to_type, 'not_attending')
      AND hx.changed_by = h.changed_by
      AND hx.changed_at = h.changed_at
  );

DELETE FROM registration_attendance_history
WHERE event_day_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM registration_attendance_history hx
    WHERE hx.registration_id = registration_attendance_history.registration_id
      AND hx.event_day_id IS NOT NULL
      AND COALESCE(hx.from_type, 'not_attending') = COALESCE(registration_attendance_history.from_type, 'not_attending')
      AND COALESCE(hx.to_type, 'not_attending') = COALESCE(registration_attendance_history.to_type, 'not_attending')
      AND hx.changed_by = registration_attendance_history.changed_by
      AND hx.changed_at = registration_attendance_history.changed_at
  );
