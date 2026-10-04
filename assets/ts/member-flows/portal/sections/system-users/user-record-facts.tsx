/**
 * What a user record states about the person, as two lists.
 *
 * Two lists because they answer two questions. Contact answers "how do I
 * reach this person", which is the address; Account answers "what is this
 * record" — the names, the role and the dates. The address appeared in both
 * until Contact existed, and a fact stated twice on one page is a fact the
 * reader has to check for agreement.
 *
 * An unset name keeps its row and shows an em dash rather than disappearing:
 * a staff reader opening this page to fix a name that came across a migration
 * wrong needs to see that the field exists and is empty, which a missing row
 * does not say.
 */
import { Badge } from "../../../../components/Badge";
import type { DescriptionListItem } from "../../../../ui/DescriptionList";
import { fmt } from "../../ui";
import type { UserDetail as UserRecord, UserMembership } from "./model";

export function userRecordFacts(
  user: UserRecord,
  identity: UserMembership | undefined,
  /**
   * Whether the names are stated elsewhere on this record.
   *
   * They are, for the one reader who owns them: their own record carries a
   * "Your profile" card that both states and edits the names, the job title
   * and the biography together, because those are the fields a member holds
   * themselves. Repeating them here would put the same name in two cards on
   * one page, which is a fact the reader then has to check for agreement.
   * Everybody else reads and edits them here, where Account is the only card
   * that states them.
   */
  options: { namesStatedElsewhere?: boolean } = {},
): { contactEmail: string; contactFacts: DescriptionListItem[]; accountFacts: DescriptionListItem[] } {
  const contactEmail = identity?.email ?? user.email;
  const contactFacts: DescriptionListItem[] = [{ term: "Email", value: <span class="pk-break">{contactEmail}</span> }];

  const accountFacts: DescriptionListItem[] = [
    // Restated only when the sign-in address is not the one above it, which is
    // the case that would otherwise be invisible.
    ...(contactEmail === user.email
      ? []
      : [{ term: "Sign-in email", value: <span class="pk-break">{user.email}</span> }]),
    ...(options.namesStatedElsewhere
      ? []
      : [
          { term: "First name", value: user.first_name },
          { term: "Last name", value: user.last_name },
          { term: "Preferred name", value: user.preferred_name },
        ]),
    { term: "Role", value: <Badge status={user.role} /> },
    { term: "Active", value: user.active ? "Yes" : "No" },
    { term: "Created", value: <span class="pk-nowrap">{fmt(user.created_at)}</span> },
  ];

  return { contactEmail, contactFacts, accountFacts };
}
