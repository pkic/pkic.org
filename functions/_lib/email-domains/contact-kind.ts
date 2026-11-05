/**
 * The contact-facing reading of the mailbox classification: a free or
 * disposable address is "personal", which organizers and sponsors see marked
 * instead of an organization, and which waiting lists handle last.
 */
import type { EmailDomainKind } from "../../../assets/shared/schemas/email-domain-kind";
import { mailboxKind } from "./classification";

/** Free and disposable mailboxes are personal; anything else may speak for an organization. */
export function emailDomainKind(email: string | null | undefined): EmailDomainKind {
  return email && mailboxKind(email) !== "work" ? "personal" : "work";
}

/** The organization a contact list shows: none for a personal mailbox, which is marked instead. */
export function contactAffiliation(
  email: string | null | undefined,
  organization: string | null,
): { organization: string | null; personalEmail: boolean } {
  const personalEmail = emailDomainKind(email) === "personal";
  return { organization: personalEmail ? null : organization, personalEmail };
}

/** Whether any of a person's verified addresses is a work address; only such a person keeps normal priority. */
export function holdsWorkAddress(addresses: readonly (string | null | undefined)[]): boolean {
  return addresses.some((address) => Boolean(address) && emailDomainKind(address) === "work");
}

/** A registrant waiting for a day while holding no verified work address is handled last. */
export function waitlistHandledLast(
  addresses: readonly (string | null | undefined)[],
  days: readonly { waitlistStatus: string | null }[],
): boolean {
  return !holdsWorkAddress(addresses) && days.some((day) => day.waitlistStatus === "waiting");
}

/**
 * The one ordering rule every waiting list applies on top of its own order:
 * entries whose person holds any verified work address come first, entries of
 * people with only personal addresses last. The sort is stable, so each group
 * keeps its original position and join time — verifying a work address, as
 * the main or a secondary address, regains that place.
 */
export function prioritizeWorkAddresses<Entry>(
  entries: readonly Entry[],
  addressesOf: (entry: Entry) => readonly (string | null | undefined)[],
): Entry[] {
  const handledLast = (entry: Entry) => !holdsWorkAddress(addressesOf(entry));
  return [...entries.filter((entry) => !handledLast(entry)), ...entries.filter(handledLast)];
}
