import {
  ACCOUNT_EMAIL_ADDRESSES_HREF,
  PERSONAL_ADDRESS_FOLLOW_UP_COPY,
  PERSONAL_ADDRESS_WAITLIST_COPY,
} from "../../../shared/email-first-copy";
import { useMailboxKind } from "../../hooks/useMailboxKind";
import { Alert } from "../../ui/Alert";
import { ButtonLink } from "../../ui/Button";

/**
 * The gentle prompt a registrant with a personal address sees: after
 * registering, to add and verify a work address; while waiting for a seat,
 * that personal-address entries are handled last. Nothing shows for a work
 * address, as the server's email-domain lists classify it — or, where the
 * server knows every verified address, by its `withoutWorkAddress` verdict.
 */
export function PersonalAddressPrompt({
  email,
  withoutWorkAddress,
  waiting = false,
}: {
  email?: string;
  /** The server's verdict over every verified address; takes precedence over the single address. */
  withoutWorkAddress?: boolean;
  waiting?: boolean;
}) {
  // Asked only when the server has not already given its verdict over every verified address.
  const kind = useMailboxKind(withoutWorkAddress === undefined ? email : null);
  if (!(withoutWorkAddress ?? (kind !== null && kind !== "work"))) return null;
  const copy = waiting ? PERSONAL_ADDRESS_WAITLIST_COPY : PERSONAL_ADDRESS_FOLLOW_UP_COPY;
  return (
    <Alert tone="info" title={copy.title}>
      <p>{copy.body}</p>
      <div class="pk-cluster">
        <ButtonLink href={ACCOUNT_EMAIL_ADDRESSES_HREF} variant="secondary">
          {copy.action}
        </ButtonLink>
      </div>
    </Alert>
  );
}
