-- Store the settlement currency and gross amount from the Stripe balance
-- transaction so the admin UI can display the USD equivalent for non-USD
-- donations.  net_amount is already stored in the settlement currency.
ALTER TABLE donations ADD COLUMN settled_currency TEXT;
ALTER TABLE donations ADD COLUMN settled_amount INTEGER;
