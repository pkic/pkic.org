import {
  PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION,
  PERSONAL_ADDRESS_HANDLED_LAST_LABEL,
} from "../../shared/email-first-copy";
import { Badge } from "../ui/Badge";

/**
 * A contact's organization in organizer lists. A personal-mailbox contact never
 * shows an organization.
 *
 * Organizers see one pill for it, whatever the registrant's standing: the
 * warning "Personal email", whose tooltip and description say such a
 * registrant is handled last on every waiting list. Sponsors receive the
 * organization as text from the server ("Personal email address" for a
 * consumer mailbox) and do not use this component.
 *
 * A registrant who typed an organization but holds no verified work address
 * is handled last too, so organizers see the warning beside the name.
 */
export function ContactOrganization({
  organization,
  personalEmail,
  handledLast = false,
}: {
  organization: string | null;
  personalEmail: boolean;
  handledLast?: boolean;
}) {
  const reason = (handledLast || personalEmail) && (
    <Badge tone="warn" dot={false} description={PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION}>
      {PERSONAL_ADDRESS_HANDLED_LAST_LABEL}
    </Badge>
  );
  if (personalEmail) return reason;
  return reason ? (
    <span class="pk-cluster">
      {organization ?? "—"}
      {reason}
    </span>
  ) : (
    <>{organization ?? "—"}</>
  );
}
