-- Normalize `users.links_json` to a single canonical shape: a JSON array of
-- link URL strings (matching assets/shared/schemas/api.ts's `linksSchema`
-- and the shape updateMyProfile already writes). Two legacy shapes exist in
-- the wild:
--
--   1. `{"linkedin": "...", "x": "..."}` — written by the original YAML
--      migration (scripts/migrate-members-yaml-to-d1.mjs) and by
--      admin-organizations.ts/admin-members.ts/member-provisioning.ts
--      before this change — the exact two-shape fork flagged in PR #1
--      review.
--   2. `[{"label": "...", "url": "..."}, ...]` — an older array-of-link-
--      objects shape that predates the current plain-string-array
--      convention; no current writer produces it, but existing rows have
--      it.
--
-- Every reader and writer now assumes a plain `string[]`; this backfill
-- makes that true for existing rows instead of every consumer having to
-- understand multiple shapes.

-- 1. `{linkedin, x}` object → `[linkedin, x]` (nulls dropped).
UPDATE users
SET links_json = (
  SELECT json_group_array(value)
  FROM (
    SELECT json_extract(users.links_json, '$.linkedin') AS value
    WHERE json_extract(users.links_json, '$.linkedin') IS NOT NULL
    UNION ALL
    SELECT json_extract(users.links_json, '$.x') AS value
    WHERE json_extract(users.links_json, '$.x') IS NOT NULL
  )
)
WHERE links_json IS NOT NULL AND json_valid(links_json) AND json_type(links_json) = 'object';

-- 2. `[{label, url}, ...]` (or a mix of those and plain strings) → plain
-- `[url, ...]`, preferring `.url` then `.label`; already-plain-string
-- elements pass through unchanged, so this is a no-op on already-canonical
-- rows. Branches on je.type (the column json_each() already provides), not
-- json_type(je.value) — json_each() yields already-unwrapped plain text for
-- string elements, and re-parsing that bare text as JSON (e.g.
-- json_type('https://...')) throws "malformed JSON" since an unquoted URL
-- isn't valid JSON on its own.
UPDATE users
SET links_json = (
  SELECT json_group_array(value)
  FROM (
    SELECT CASE
             WHEN je.type = 'object'
               THEN COALESCE(json_extract(je.value, '$.url'), json_extract(je.value, '$.label'))
             ELSE je.value
           END AS value
    FROM json_each(users.links_json) je
  )
  WHERE value IS NOT NULL
)
WHERE links_json IS NOT NULL AND json_valid(links_json) AND json_type(links_json) = 'array';
