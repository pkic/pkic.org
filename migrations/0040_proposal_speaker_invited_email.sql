-- A speaker invitation is mailed to one address, which may be an alias of an existing account.
-- Until the speaker accepts, the proposer sees that address rather than the account's primary one,
-- and only that mailbox may continue from the link without another proof. NULL on rows that predate it.
ALTER TABLE proposal_speakers ADD COLUMN invited_email TEXT;
