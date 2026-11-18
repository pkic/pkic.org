/**
 * Account setup's organization step, between opening a sign-in link and the
 * portal: a work address without an organization names it here, or, on a
 * domain no organization has claimed, continues as a personal address.
 *
 * No session exists yet. Every request repeats the same link, which the
 * server redeems only once the step is answered.
 */
import { useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { ACCOUNT_ORGANIZATION_COPY } from "../../../../shared/account-organization-copy";
import { EMAIL_FIRST_ADVISORY_COPY } from "../../../../shared/email-first-copy";
import type { AccountOrganizationRequired } from "../../../../shared/schemas/account-organization";
import {
  userAuthVerifyResponseSchema,
  userAuthVerifySchema,
  type userAuthEstablishedResponseSchema,
} from "../../../../shared/schemas/user-auth";
import { LoginFrame } from "../../../components/sign-in/LoginFrame";
import {
  VerifiedOrganizationDetails,
  type VerifiedOrganizationController,
} from "../../../components/identities/VerifiedOrganizationDetails";
import { ApiClientError, postJson } from "../../../shared/api-client";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";

type Session = z.infer<typeof userAuthEstablishedResponseSchema>;
type Step = AccountOrganizationRequired["organizationRequired"];
type VerifyBody = Omit<z.input<typeof userAuthVerifySchema>, "token">;

export function AccountOrganizationStep({
  token,
  step: initialStep,
  onSignedIn,
}: {
  token: string;
  step: Step;
  onSignedIn: (session: Session) => Promise<void>;
}) {
  const details = useRef<VerifiedOrganizationController>({});
  const [step, setStep] = useState(initialStep);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState("");
  const domain = step.affiliation.email.split("@")[1] ?? "";

  /** The step's affiliation, or the session when the server no longer asks. */
  async function verify(body: VerifyBody): Promise<Step | Session> {
    const result = await postJson(
      "/api/v1/auth/verify-link",
      userAuthVerifySchema.parse({ token, ...body }),
      userAuthVerifyResponseSchema,
    );
    return "organizationRequired" in result ? result.organizationRequired : result;
  }

  async function affiliation(body: VerifyBody) {
    const result = await verify(body);
    if ("affiliation" in result) return result.affiliation;
    await onSignedIn(result);
    return step.affiliation;
  }

  /** One answer at a time: state lags a render behind, so a double click would otherwise send two. */
  async function send(work: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : ACCOUNT_ORGANIZATION_COPY.failed);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function answer(body: VerifyBody) {
    const result = await verify(body);
    if ("affiliation" in result) {
      // The details start over from the step the server sent, so no earlier organization list or choice is resent.
      setStep(result);
      setRound((current) => current + 1);
      setError(ACCOUNT_ORGANIZATION_COPY.stillRequired);
    } else await onSignedIn(result);
  }

  const finish = () =>
    send(async () => {
      if (!(await details.current.prepare?.())) return;
      const selected = details.current.read?.();
      if (!selected || "refused" in selected || !selected.contextToken) return;
      await answer({ organization: { contextToken: selected.contextToken } });
    });

  return (
    <LoginFrame
      label={ACCOUNT_ORGANIZATION_COPY.title}
      title={ACCOUNT_ORGANIZATION_COPY.title}
      lede={
        step.personalAllowed
          ? ACCOUNT_ORGANIZATION_COPY.unclaimedIntro(domain)
          : ACCOUNT_ORGANIZATION_COPY.claimedIntro(domain)
      }
      busy={busy}
    >
      <VerifiedOrganizationDetails
        key={round}
        confirmSole
        initial={step.affiliation}
        emailId={null}
        controller={details.current}
        resolve={(next) => affiliation({ affiliation: { domain: next } })}
        prepare={({ phase: _phase, email: _email, emailId: _id, ...selection }) =>
          affiliation({ affiliation: { selection } })
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <fieldset class="pk-login__controls pk-stack" disabled={busy}>
        <Button variant="primary" loading={busy} onClick={() => void finish()}>
          {ACCOUNT_ORGANIZATION_COPY.finish}
        </Button>
        {step.personalAllowed && (
          <Button variant="secondary" onClick={() => void send(() => answer({ organization: { personal: true } }))}>
            {EMAIL_FIRST_ADVISORY_COPY.usePersonal}
          </Button>
        )}
      </fieldset>
    </LoginFrame>
  );
}
