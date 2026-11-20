-- Deleting an account is its own capability, held by administrators. It is
-- separate from anonymizing because it removes the person's records with the
-- account instead of keeping them without a name. Data only; no schema change.
INSERT INTO role_permissions(id,role_id,permission,created_at)
SELECT lower(hex(randomblob(16))),'role-admin','users:delete',strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE EXISTS(SELECT 1 FROM roles WHERE roles.id='role-admin')
  AND NOT EXISTS(SELECT 1 FROM role_permissions existing WHERE existing.role_id='role-admin' AND existing.permission='users:delete');
