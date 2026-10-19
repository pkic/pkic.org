import { render } from "preact";
import { useState } from "preact/hooks";
import {
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
  type RegistrationSponsorSharing,
} from "../../shared/schemas/registration";
import { patchJson } from "../shared/api-client";
import { normalizeValidation } from "../shared/form/validation-map";
import { formatDateTime } from "../shared/ui";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { DescriptionList } from "../ui/DescriptionList";
import { FormSection } from "../ui/FormSection";
import { confirmAction, ConfirmDialogHost } from "./ConfirmDialog";

/** Sharing changes only after an authoritative receipt for this registration. */
function SponsorContactSharing({ initial, endpoint }: { initial: RegistrationSponsorSharing; endpoint: string }) {
  const [sharing, setSharing] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function withdraw(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Withdraw sponsor contact sharing?",
      consequences: [
        "Sponsors of this event no longer receive your contact details",
        "Copies sponsors have already downloaded cannot be recalled",
      ],
      confirmLabel: "Withdraw sharing",
      cancelLabel: "Keep sharing",
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await patchJson(
        endpoint,
        registrationManageSchema.parse({ action: "withdraw_sponsor_sharing" }),
        registrationManageUpdateResponseSchema,
      );
      setSharing(saved.sponsorSharing);
    } catch (failure) {
      setError(normalizeValidation(failure).globalMessage);
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormSection layout="stack" title="Sponsor contact sharing">
      <div role="status" aria-live="polite">
        <DescriptionList
          items={[
            {
              term: "Status",
              value: sharing.allowed ? "Sharing enabled" : sharing.withdrawnAt ? "Sharing withdrawn" : "Not sharing",
            },
            ...(!sharing.allowed && sharing.withdrawnAt
              ? [{ term: "Withdrawn", value: formatDateTime(sharing.withdrawnAt) }]
              : []),
          ]}
        />
      </div>
      <p class="pk-muted pk-small">
        Withdrawing sharing stops future disclosure of your contact details to sponsors for this event. Copies sponsors
        have already downloaded cannot be recalled.
      </p>
      {sharing.allowed && (
        <div class="pk-cluster">
          <Button type="button" variant="danger-quiet" loading={busy} onClick={() => void withdraw()}>
            Withdraw sharing…
          </Button>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </FormSection>
  );
}

export function mountSponsorContactSharing(
  root: HTMLElement,
  endpoint: string,
  sharing: RegistrationSponsorSharing,
): void {
  const host = root.querySelector<HTMLElement>("[data-sponsor-contact-sharing]");
  if (host)
    render(
      <>
        <SponsorContactSharing initial={sharing} endpoint={endpoint} />
        {/* The withdrawal confirms in the shared dialog, which needs a host on this public page. */}
        <ConfirmDialogHost />
      </>,
      host,
    );
}
