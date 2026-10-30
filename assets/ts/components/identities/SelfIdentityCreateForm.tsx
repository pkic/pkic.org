import { VerifiedOrganizationDetails, type VerifiedOrganizationController } from "./VerifiedOrganizationDetails";
import { useRef } from "preact/hooks";
/** Email-first representation onboarding: production mailbox proof, followed by the canonical domain rule. */
import type { z } from "zod";
import { useEffect, useState } from "preact/hooks";
import { currentUserIdentityCreateSchema, identityMutationResponseSchema } from "../../../shared/schemas/identity";
import {
  identityAffiliationPreviewSchema,
  identityAffiliationPreviewResponseSchema,
} from "../../../shared/schemas/identity-affiliation";
import {
  ownRepresentationEmailAddSchema,
  ownEmailVerificationRequestedResponseSchema,
  ownEmailAddressesListResponseSchema,
  type OwnEmailAddress,
} from "../../../shared/schemas/own-email-addresses";
import { useContractForm } from "../../hooks/useContractForm";
import { getJson, postJson } from "../../shared/api-client";
import { OWN_EMAILS_ENDPOINT } from "../../shared/email-address-paths";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { DescriptionList } from "../../ui/DescriptionList";
import { EmailAddressCreateForm } from "./EmailAddressCreateForm";
import { verificationLinkNotice } from "./verification-link-notice";
import type { ImmediateEmailDelivery } from "../../../shared/schemas/email-outbox";

const PREVIEW_ENDPOINT = "/api/v1/users/current/identities/preview";
type Resolved = z.infer<typeof identityAffiliationPreviewResponseSchema>;
export function SelfIdentityCreateForm({
  onCreated,
  onBusy,
  onActionLabel,
}: {
  onCreated: (result: z.infer<typeof identityMutationResponseSchema>) => void | Promise<void>;
  onBusy?: (busy: boolean) => void;
  onActionLabel?: (label: string) => void;
}) {
  const [stage, setStage] = useState<"email" | "waiting" | "details">("email");
  const [email, setEmail] = useState("");
  const [individual, setIndividual] = useState(false);
  const [address, setAddress] = useState<Pick<OwnEmailAddress, "id" | "email"> | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delivery, setDelivery] = useState<ImmediateEmailDelivery>("sent");
  useEffect(() => onBusy?.(busy), [busy]);
  useEffect(
    () =>
      onActionLabel?.(
        stage === "email" ? "Continue" : stage === "waiting" ? "Check verification" : "Add representation",
      ),
    [stage],
  );
  const proofForm = useContractForm(identityAffiliationPreviewSchema, {
    phase: "resolve",
    email,
    emailId: address?.id ?? null,
    unaffiliatedAttestation: individual,
  });
  const details = useRef<VerifiedOrganizationController>({});
  async function ownAddresses() {
    return (await getJson(OWN_EMAILS_ENDPOINT, ownEmailAddressesListResponseSchema)).emails;
  }
  async function resolve(value: Pick<OwnEmailAddress, "id" | "email">, contract = proofForm, domain?: string) {
    const result = await postJson(
      PREVIEW_ENDPOINT,
      identityAffiliationPreviewSchema.parse({
        phase: "resolve",
        email: value.email,
        emailId: value.id,
        domain,
        unaffiliatedAttestation: individual,
      }),
      identityAffiliationPreviewResponseSchema,
    );
    setAddress(value);
    setEmail(value.email);
    setResolved(result);
    setError("");
    contract.reset();
    if (individual && result.identityId)
      await onCreated({ success: true, identityId: result.identityId, state: "active" });
    else setStage("details");
  }
  if (stage === "email")
    return (
      <EmailAddressCreateForm
        isSelf
        embedded
        onIndividualChange={setIndividual}
        onBusy={setBusy}
        beforeAdd={async (value) => {
          let handled = false;
          try {
            const existing = (await ownAddresses()).find((item) => item.email.toLowerCase() === value.toLowerCase());
            if (!existing) return false;
            handled = true;
            setAddress(existing);
            setEmail(existing.email);
            if (existing.verifiedAt) await resolve(existing);
            else {
              const requested = await postJson(
                OWN_EMAILS_ENDPOINT,
                ownRepresentationEmailAddSchema.parse({
                  email: value,
                  purpose: "representation",
                  unaffiliatedAttestation: individual,
                }),
                ownEmailVerificationRequestedResponseSchema,
              );
              setDelivery(requested.delivery);
              setStage("waiting");
            }
            return true;
          } finally {
            if (handled) setBusy(false);
          }
        }}
        onAdded={(added) => {
          setEmail(added.email);
          setDelivery(added.delivery ?? "sent");
          setStage("waiting");
          setBusy(false);
        }}
      />
    );
  if (stage === "waiting")
    return (
      <form
        noValidate
        class="pk-stack"
        {...proofForm.handlers}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const checked = proofForm.submit();
          if (!checked.data) return setError(checked.formMessage ?? "");
          setBusy(true);
          setError("");
          try {
            const current = (await ownAddresses()).find((item) => item.email.toLowerCase() === email.toLowerCase());
            await resolve(current ?? { id: null, email });
          } catch (cause) {
            setError(proofForm.refuse(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        {delivery === "sent" ? (
          <p>
            Open the verification email sent to <strong>{email}</strong> and confirm the address. Then return here.
          </p>
        ) : (
          <Alert tone="warn">{verificationLinkNotice(email, delivery).message}</Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Button
          variant="link"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const requested = await postJson(
                OWN_EMAILS_ENDPOINT,
                ownRepresentationEmailAddSchema.parse({
                  email,
                  purpose: "representation",
                  unaffiliatedAttestation: individual,
                }),
                ownEmailVerificationRequestedResponseSchema,
              );
              setDelivery(requested.delivery);
            } catch (cause) {
              setError(proofForm.refuse(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          Resend verification email
        </Button>
        <Button
          variant="link"
          onClick={() => {
            setStage("email");
            setError("");
          }}
        >
          Use another email
        </Button>
      </form>
    );
  return (
    <form
      noValidate
      class="pk-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          if (!(await details.current.prepare?.())) return;
          const checked = details.current.read?.();
          if (!checked || "refused" in checked) return;
          const result = await postJson(
            "/api/v1/users/current/identities",
            currentUserIdentityCreateSchema.parse({ contextToken: checked.contextToken }),
            identityMutationResponseSchema,
          );
          await onCreated(result);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not add the representation.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <DescriptionList items={[{ term: "Verified representation email", value: email }]} />
      {resolved && (
        <VerifiedOrganizationDetails
          initial={resolved}
          emailId={address?.id ?? null}
          controller={details.current}
          resolve={(domain) =>
            postJson(
              PREVIEW_ENDPOINT,
              identityAffiliationPreviewSchema.parse({ phase: "resolve", email, emailId: address?.id ?? null, domain }),
              identityAffiliationPreviewResponseSchema,
            )
          }
          prepare={(input) => postJson(PREVIEW_ENDPOINT, input, identityAffiliationPreviewResponseSchema)}
        />
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button
        variant="link"
        onClick={() => {
          setStage("email");
          setError("");
        }}
      >
        Use another email
      </Button>
    </form>
  );
}
