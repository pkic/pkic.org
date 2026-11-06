import {
  PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION,
  PERSONAL_ADDRESS_HANDLED_LAST_LABEL,
  PERSONAL_EMAIL_ADDRESS_LABEL,
} from "../../shared/email-first-copy";
import { Badge } from "../ui/Badge";

/**
 * A contact's organization in organizer and sponsor lists. A personal-mailbox contact never
 * shows an organization.
 *
 * Organizers see a warning only when the registrant is handled last. A personal
 * primary address with a verified work address keeps the neutral mailbox label.
 * Sponsor views render the personal-mailbox label from the shared classification flag.
 *
 * A registrant who typed an organization but holds no verified work address
 * is handled last too, so organizers see the warning beside the name.
 */
export function ContactOrganization({
  organization,
  personalEmail,
  handledLast = false,
  audience = "organizer",
}: {
  organization: string | null;
  personalEmail: boolean;
  handledLast?: boolean;
  audience?: "organizer" | "sponsor";
}) {
  if (audience === "sponsor") return <>{personalEmail ? PERSONAL_EMAIL_ADDRESS_LABEL : (organization ?? "—")}</>;
  const reason = handledLast && (
    <Badge tone="warn" dot={false} description={PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION}>
      {PERSONAL_ADDRESS_HANDLED_LAST_LABEL}
    </Badge>
  );
  if (personalEmail)
    return (
      reason || (
        <Badge tone="neutral" dot={false}>
          {PERSONAL_EMAIL_ADDRESS_LABEL}
        </Badge>
      )
    );
  return reason ? (
    <span class="pk-cluster">
      {organization ?? "—"}
      {reason}
    </span>
  ) : (
    <>{organization ?? "—"}</>
  );
}
