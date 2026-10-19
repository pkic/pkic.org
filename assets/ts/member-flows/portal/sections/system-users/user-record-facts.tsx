/**
 * What a user record states about the person, as two lists.
 *
 * Two lists because they answer two questions. Contact answers "how do I
 * reach this person", which is the address; Account answers "what is this
 * record" — the names and the dates. The address appeared in both
 * until Contact existed, and a fact stated twice on one page is a fact the
 * reader has to check for agreement.
 *
 * An unset name keeps its row and shows an em dash rather than disappearing:
 * a staff reader opening this page to fix a name that came across a migration
 * wrong needs to see that the field exists and is empty, which a missing row
 * does not say.
 */
import type { DescriptionListItem } from "../../../../ui/DescriptionList";
import { fmt } from "../../ui";
import type { UserDetail as UserRecord, UserMembership } from "./model";

export function userRecordFacts(
  user: UserRecord,
  identity: UserMembership | undefined,
  options: {
    /**
     * Whether the reader is the person the record is about. Whether the
     * account is active and when it was created are administration: the
     * owner of a live session knows the first, and neither is theirs to act on.
     */
    readerIsSubject?: boolean;
  } = {},
): { contactEmail: string; contactFacts: DescriptionListItem[]; accountFacts: DescriptionListItem[] } {
  const contactEmail = identity?.email ?? user.email;
  const contactFacts: DescriptionListItem[] = [{ term: "Email", value: <span class="pk-break">{contactEmail}</span> }];

  const accountFacts: DescriptionListItem[] = [
    // Restated only when the sign-in address is not the one above it, which is
    // the case that would otherwise be invisible.
    ...(contactEmail === user.email
      ? []
      : [{ term: "Sign-in email", value: <span class="pk-break">{user.email}</span> }]),
    { term: "First name", value: user.first_name },
    { term: "Last name", value: user.last_name },
    { term: "Preferred name", value: user.preferred_name },
    ...(options.readerIsSubject
      ? []
      : [
          { term: "Active", value: user.active ? "Yes" : "No" },
          { term: "Created", value: <span class="pk-nowrap">{fmt(user.created_at)}</span> },
        ]),
  ];

  return { contactEmail, contactFacts, accountFacts };
}
