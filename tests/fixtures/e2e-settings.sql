-- Authored public pages reference the configured forum slug, not the historical migration default.
UPDATE groups
SET slug = 'pkic', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = '20000000-0000-4000-8000-000000000001';

-- Production migration assigns the imported PQC conference to the PQC working
-- group. Keep the browser fixture in that same post-migration state so legacy
-- event URLs exercise their redirect into the canonical group workspace.
UPDATE events
SET owner_group_id = '20000000-0000-4000-8000-000000000003',
    visibility = 'public',
    profile_key = COALESCE(profile_key, 'conference'),
    source_mode = COALESCE(source_mode, 'hugo')
WHERE slug = 'pqc-conference-amsterdam-nl';
