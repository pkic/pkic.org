-- Apply only after the code from 0049 is live: older code reads this table.
-- Nothing references it; its triggers were dropped in 0049.
-- session_email_authentication.permission_revision is no longer read; new rows
-- carry a constant until a later cleanup can drop the column.
DROP TABLE IF EXISTS user_email_sign_in_permissions;
