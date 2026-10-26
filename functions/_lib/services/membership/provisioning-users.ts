/** Resolve the person receiving a provisioned identity through the canonical mailbox ownership policy. */
import { buildFindOrCreateUserStatement, findUserByEmail, splitPersonName } from "../users";
import { readEmailOwnership, provedMailboxUserId } from "../email-ownership";
import { prepareVerifyOwnedEmailStatements } from "../email-verification";
import { normalizeEmail } from "../../validation";
import type { DatabaseLike } from "../../types";

export interface ProvisionIdentityInput {
  name: string;
  email: string;
  jobTitle?: string | null;
  biography?: string | null;
  links?: string[] | null;
}

export async function buildProvisioningUser(
  db: DatabaseLike,
  identityInput: ProvisionIdentityInput,
  mailboxVerified = false,
) {
  const { firstName, lastName } = splitPersonName(identityInput.name);
  const prepared = await buildFindOrCreateUserStatement(db, {
    email: identityInput.email,
    mailboxVerified,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
    // Provisioning creates the person's membership identity in its own batch.
    identityInBatch: true,
  });
  if (mailboxVerified)
    prepared.statements.push(
      ...prepareVerifyOwnedEmailStatements(db, {
        userId: prepared.user.id,
        normalizedEmail: normalizeEmail(identityInput.email),
        method: "magic_link",
      }),
    );
  return prepared;
}

export async function findProvisioningUser(db: DatabaseLike, email: string, mailboxVerified = false) {
  if (!mailboxVerified) return findUserByEmail(db, email);
  const id = provedMailboxUserId(await readEmailOwnership(db, normalizeEmail(email)));
  return id ? { id } : null;
}
