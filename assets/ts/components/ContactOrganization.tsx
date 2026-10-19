import {
  PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION,
  PERSONAL_ADDRESS_HANDLED_LAST_LABEL,
  PERSONAL_EMAIL_ADDRESS_LABEL,
} from "../../shared/email-first-copy";
import { Badge } from "../ui/Badge";

/**
 * A contact's organization in organizer and sponsor lists. A personal-mailbox
 * contact never shows an organization.
 *
 * Organizers see one pill for it, whatever the registrant's standing: the
 * warning "Personal email", whose tooltip and description say such a
 * registrant is handled last on every waiting list. A grey "Personal email
 * address" marker on some rows and the warning on others stated one fact in
 * two vocabularies down the same column. Sponsors see the neutral marker:
 * waiting-list order is not theirs to weigh.
 *
 * A registrant who typed an organization but holds no verified work address
 * is handled last too, so organizers see the warning beside the name.
 */
export function ContactOrganization({
  organization,
  personalEmail,
  handledLast = false,
  audience = "sponsor",
}: {
  organization: string | null;
  personalEmail: boolean;
  handledLast?: boolean;
  audience?: "organizer" | "sponsor";
}) {
  const reason = (handledLast || (personalEmail && audience === "organizer")) && (
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
