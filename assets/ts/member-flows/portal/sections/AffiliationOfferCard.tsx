/**
 * The organization question a signed-in person is asked, when there is one.
 *
 * A verified address that linked them to an organization automatically is
 * told first, once: "that's right" keeps the link, and "not my organization"
 * ends the identity the link created.
 *
 * A verified work address whose domain belongs to an organization they have
 * no relationship with yet offers that organization: joining is the existing
 * join (the same route an organization's own verified domain uses), and "not
 * my organization" stops the offer. When every verified address is personal
 * mail, which never links to an organization, the card leads them to add and
 * verify their work address, or lets them say they are independent.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  affiliationLinkKeptSchema,
  affiliationOfferDismissalSchema,
  affiliationOfferResponseSchema,
  type AffiliationOffer,
} from "../../../../shared/schemas/affiliation-offer";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { currentUserIdentityCreateSchema, identityMutationResponseSchema } from "../../../../shared/schemas/identity";
import { useData } from "../../../hooks/useData";
import { useContractForm } from "../../../hooks/useContractForm";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../../../shared/email-first-copy";
import { Field } from "../../../ui/Field";
import { TextInput } from "../../../ui/TextControl";
import { getJson, postJson } from "../../../shared/api-client";
import { Button, ButtonLink } from "../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { usePortalHashLocation } from "../hash-location";
import { portalSession } from "../state";
import { toast } from "../ui";
import { addEmailAddressPath } from "../../../shared/email-address-paths";

const OFFER_ENDPOINT = "/api/v1/users/current/identities/offer";

function domainList(domains: readonly string[]): string {
  return domains.map((domain) => `@${domain}`).join(", ");
}

/**
 * Confirming an organization says what the person does there: an organization
 * identity always carries a job title. The contract the route parses checks
 * it, and a refusal lands on the field.
 */
function OrganizationAnswer({
  schema,
  body,
  send,
  busy,
  confirmLabel,
  children,
}: {
  schema: typeof affiliationLinkKeptSchema | typeof currentUserIdentityCreateSchema;
  body: (jobTitle: string) => Record<string, unknown>;
  send: (data: Record<string, unknown>) => Promise<void>;
  busy: boolean;
  confirmLabel: string;
  children?: ComponentChildren;
}) {
  const [jobTitle, setJobTitle] = useState("");
  const form = useContractForm(schema, body(jobTitle));
  return (
    <form
      noValidate
      class="pk-stack pk-stack--snug"
      {...form.handlers}
      onSubmit={(event) => {
        event.preventDefault();
        const checked = form.submit();
        if (checked.data) void send(checked.data).catch((reason: unknown) => toast(form.refuse(reason), "error"));
      }}
    >
      <Field
        label={ORGANIZATION_JOB_TITLE_COPY.label}
        help={ORGANIZATION_JOB_TITLE_COPY.help}
        required
        {...form.of("jobTitle")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="jobTitle"
            autoComplete="organization-title"
            value={jobTitle}
            onInput={(event) => setJobTitle(event.currentTarget.value)}
          />
        )}
      </Field>
      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={busy}>
          {confirmLabel}
        </Button>
        {children}
      </div>
    </form>
  );
}

function WrittenName({ offer }: { offer: Exclude<AffiliationOffer, { kind: "linked" }> }) {
  if (!offer.writtenOrganizationName) return null;
  if (offer.kind === "organization" && offer.writtenOrganizationName === offer.organization.name) return null;
  return <p class="pk-small pk-muted">Your profile said “{offer.writtenOrganizationName}”.</p>;
}

export function AffiliationOfferCard() {
  const loaded = useData(() => getJson(OFFER_ENDPOINT, affiliationOfferResponseSchema), []);
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState(false);
  const offer = loaded.data?.offer ?? null;
  // An optional question: when it cannot be read, the page simply does not ask it.
  if (answered || !offer) return null;

  async function answer(action: () => Promise<unknown>, message: string, rethrow = false): Promise<void> {
    setBusy(true);
    try {
      await action();
      toast(message, "success");
      setAnswered(true);
    } catch (reason) {
      // A form that sent the request reads the refusal onto its own fields.
      if (rethrow) throw reason;
      toast((reason as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const dismiss = (organizationId: string | null, message: string) =>
    answer(
      () =>
        postJson(
          `${OFFER_ENDPOINT}/dismissals`,
          affiliationOfferDismissalSchema.parse({ organizationId }),
          successResponseSchema,
        ),
      message,
    );

  if (offer.kind === "linked") {
    const keep = (data: Record<string, unknown>) =>
      answer(
        () => postJson(`${OFFER_ENDPOINT}/confirmations`, data, successResponseSchema),
        `You represent ${offer.organization.name}`,
        true,
      );
    return (
      <Panel aria-label="Your organization">
        <PanelHeader title="Your organization" />
        <PanelBody class="pk-stack pk-stack--snug">
          <p>
            You’re now linked to <strong>{offer.organization.name}</strong> (from your @{offer.domain} email).
          </p>
          <OrganizationAnswer
            schema={affiliationLinkKeptSchema}
            body={(jobTitle) => ({ organizationId: offer.organization.id, jobTitle })}
            send={keep}
            busy={busy}
            confirmLabel="That’s right"
          >
            <Button
              disabled={busy}
              onClick={() => void dismiss(offer.organization.id, `You no longer represent ${offer.organization.name}`)}
            >
              Not my organization
            </Button>
          </OrganizationAnswer>
        </PanelBody>
      </Panel>
    );
  }

  if (offer.kind === "organization") {
    const join = (data: Record<string, unknown>) =>
      answer(
        () => postJson("/api/v1/users/current/identities", data, identityMutationResponseSchema),
        `You represent ${offer.organization.name}`,
        true,
      );
    return (
      <Panel aria-label="Your organization">
        <PanelHeader title="Your organization" />
        <PanelBody class="pk-stack pk-stack--snug">
          <p>
            You’ll be linked to <strong>{offer.organization.name}</strong> (from your @{offer.domain} email).
          </p>
          <WrittenName offer={offer} />
          <OrganizationAnswer
            schema={currentUserIdentityCreateSchema}
            body={(jobTitle) => ({ emailId: offer.emailId, organizationId: offer.organization.id, jobTitle })}
            send={join}
            busy={busy}
            confirmLabel={`Join ${offer.organization.name}`}
          >
            <Button
              disabled={busy}
              onClick={() => void dismiss(offer.organization.id, `${offer.organization.name} won’t be offered again`)}
            >
              Not my organization
            </Button>
          </OrganizationAnswer>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel aria-label="Use your organization email address">
      <PanelHeader title="Use your organization email address" />
      <PanelBody class="pk-stack pk-stack--snug">
        <p>
          You join your organization through its email address. Personal addresses such as{" "}
          {domainList(offer.freeDomains)} never link you to an organization, so add and verify your work email address
          to represent your organization.
        </p>
        <WrittenName offer={offer} />
        <div class="pk-cluster">
          <ButtonLink
            variant="primary"
            href={usePortalHashLocation.hrefs(addEmailAddressPath(portalSession.value?.identity.id ?? "current"))}
          >
            Add your work address
          </ButtonLink>
          <Button loading={busy} onClick={() => void dismiss(null, "Noted: you take part as yourself")}>
            I’m independent
          </Button>
        </div>
      </PanelBody>
    </Panel>
  );
}
