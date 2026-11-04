import type { EventProposalProofSupportReason } from "../../shared/schemas/event-proposal-proof";
import { PROOF_SUPPORT_COPY } from "../../shared/email-first-copy";
import { CONSORTIUM_CONTACT_HREF } from "../../shared/consortium-contact";
import { Alert } from "../ui/Alert";
import { Button, ButtonLink } from "../ui/Button";

/** Actionable next steps after a verified proposal address needs consortium review. */
export function ProposalProofSupportNotice({
  email,
  reason,
  onUsePersonal,
}: {
  email: string;
  reason: EventProposalProofSupportReason;
  onUsePersonal: () => void;
}) {
  return (
    <Alert tone="warn" title={PROOF_SUPPORT_COPY[reason].title}>
      <p>{PROOF_SUPPORT_COPY[reason].body(email)}</p>
      <p>{PROOF_SUPPORT_COPY[reason].next}</p>
      <div class="pk-cluster">
        {reason === "organization_domain_review" && (
          <Button type="button" variant="secondary" onClick={onUsePersonal}>
            {PROOF_SUPPORT_COPY.personalAction}
          </Button>
        )}
        <ButtonLink href={CONSORTIUM_CONTACT_HREF} external={false} variant="secondary">
          {PROOF_SUPPORT_COPY.contactAction}
        </ButtonLink>
      </div>
    </Alert>
  );
}
