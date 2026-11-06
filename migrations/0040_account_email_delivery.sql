-- Delivery state is owned by each existing account email address, independently of outbox retention.

ALTER TABLE users ADD COLUMN delivery_bounced_at TEXT;
ALTER TABLE users ADD COLUMN delivery_blocked_at TEXT;
ALTER TABLE users ADD COLUMN delivery_delayed_at TEXT;
ALTER TABLE users ADD COLUMN delivery_delivered_at TEXT;

-- A replacement mailbox must not inherit the previous mailbox's state.
CREATE TRIGGER users_reset_address_delivery
AFTER UPDATE OF email ON users
WHEN lower(OLD.email) <> lower(NEW.email)
BEGIN
  UPDATE users SET delivery_bounced_at = NULL, delivery_blocked_at = NULL, delivery_delayed_at = NULL, delivery_delivered_at = NULL WHERE id = NEW.id;
END;

ALTER TABLE user_emails ADD COLUMN delivery_bounced_at TEXT;
ALTER TABLE user_emails ADD COLUMN delivery_blocked_at TEXT;
ALTER TABLE user_emails ADD COLUMN delivery_delayed_at TEXT;
ALTER TABLE user_emails ADD COLUMN delivery_delivered_at TEXT;

-- A replacement mailbox must not inherit the previous mailbox's state.
CREATE TRIGGER user_emails_reset_address_delivery
AFTER UPDATE OF email ON user_emails
WHEN lower(OLD.email) <> lower(NEW.email)
BEGIN
  UPDATE user_emails SET delivery_bounced_at = NULL, delivery_blocked_at = NULL, delivery_delayed_at = NULL, delivery_delivered_at = NULL WHERE id = NEW.id;
END;
