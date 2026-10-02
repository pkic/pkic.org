import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { Radio, Checkbox } from "../ui/Checkbox";
import { Button, ButtonLink } from "../ui/Button";

export interface MembershipDocument {
  key: string;
  title: string;
  href: string;
  html: string;
}

function LegalAgreement({ document }: { document: MembershipDocument }) {
  return (
    <section class="membership-legal-card" data-membership-legal-field={document.key}>
      <header class="membership-legal-card-header">
        <p>
          Review the{" "}
          <a href={document.href} target="_blank" rel="noopener noreferrer">
            {document.title}
          </a>
          , then confirm your agreement below.
        </p>
      </header>
      <div class="membership-legal-card-scroll" tabIndex={0} aria-label={`${document.title} document`}>
        <article class="membership-legal-document" dangerouslySetInnerHTML={{ __html: document.html }} />
      </div>
      <div class="membership-legal-acceptance">
        <Field group label="Agreement" errorSlot={document.key}>
          {() => (
            <Checkbox
              name={`custom.${document.key}`}
              data-membership-legal-input
              required
              label={<span data-membership-legal-label>I agree to the membership terms in this document</span>}
            />
          )}
        </Field>
      </div>
    </section>
  );
}

/** Static markup consumed by the existing contract-driven membership flow. */
export function JoinFlow({ documents }: { documents: MembershipDocument[] }) {
  return (
    <div data-member-application data-module="member-flows/join-form" class="pk pk-stack join-flow">
      <div data-flow-status class="pk-alert pk-sr-only" role="alert" aria-live="polite" />
      <div data-join-start>
        <p class="pk-lede">First, tell us whether an organization is connected to your participation.</p>
        <form data-join-start-form class="pk-form needs-validation" noValidate>
          <Field
            group
            label="Are you employed by, or do you own, an organization?"
            errorSlot="applicantKind"
            help="If an organization has separately authorized you to act on its behalf, choose Yes even if you are not its employee or owner."
          >
            {(control) => (
              <div class="pk-stack pk-stack--snug">
                <Radio
                  name="applicantKind"
                  value="organization"
                  required
                  aria-describedby={control["aria-describedby"]}
                  label="Yes — I am employed by or own an organization"
                />
                <Radio
                  name="applicantKind"
                  value="individual"
                  required
                  aria-describedby={control["aria-describedby"]}
                  label="No — I am not employed by and do not own an organization"
                />
              </div>
            )}
          </Field>
          <div data-join-path-details hidden>
            <div data-join-organization-policy class="pk-alert pk-alert--info" hidden>
              You must participate on behalf of that organization. Use an email address belonging to it so we can verify
              the relationship and keep organizational and IPR attribution clear.
            </div>
            <div data-join-individual-policy class="pk-alert pk-alert--warn" hidden>
              Individual participation is limited to eligible categories for people who are not employed by, do not own,
              and are not acting for an organization.
            </div>
            <div data-join-individual-categories hidden>
              <p class="pk-strong">Eligible individual categories</p>
              <div data-join-individual-category-list class="pk-muted pk-small" aria-live="polite">
                Loading eligible categories…
              </div>
            </div>
            <Field
              id="joinEmail"
              label="Your official work or organization email address"
              errorSlot="email"
              help="We will send a short-lived verification link before showing the appropriate next step."
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@organization.example"
                  required
                  disabled
                />
              )}
            </Field>
            <Button type="submit" variant="primary">
              Continue
            </Button>
          </div>
        </form>
      </div>
      <section data-join-verification-pending hidden tabIndex={-1}>
        <h2>Check your email</h2>
        <p>
          We sent an email to <strong data-join-pending-email /> with your next step. Follow the instructions to
          continue.
        </p>
        <Button data-edit-join-email>Use a different email address</Button>
      </section>
      <section data-join-organization-access hidden tabIndex={-1}>
        <h2>Organization access is ready</h2>
        <p>
          Your verified email address is associated with an active PKI Consortium member organization. No new membership
          application is needed.
        </p>
        <ButtonLink variant="primary" href="/portal/">
          Continue to the portal
        </ButtonLink>
      </section>
      <section data-join-already-member hidden tabIndex={-1}>
        <h2>You already have member access</h2>
        <p>
          You do not need to submit another membership application. Sign in to the portal with the same email address.
        </p>
        <ButtonLink variant="primary" href="/portal/">
          Sign in to the member portal
        </ButtonLink>
      </section>
      <section data-join-support-required hidden tabIndex={-1}>
        <h2>We need to review this request</h2>
        <p>
          We could not safely determine the appropriate membership path from this email address. Please contact the PKI
          Consortium so we can help.
        </p>
        <ButtonLink href="/contact/">Contact the PKI Consortium</ButtonLink>
      </section>
      <form data-join-application-form class="join-application-form pk-stack needs-validation" noValidate hidden>
        <div class="membership-verified-context">
          <p>
            <strong data-verified-application-kind /> using verified email address{" "}
            <strong data-verified-application-email />.
          </p>
          <p class="pk-small">
            Your verified email address and application path are fixed for this application. Start again if either is
            incorrect.
          </p>
        </div>
        <p class="pk-muted pk-small">
          Only eligibility categories permitted for this verified application path are available below. Any required fee
          is shown with the category before you submit.
        </p>
        <Field
          group
          label="Eligibility category"
          errorSlot="membershipCategory"
          help="The available categories are determined from your verified membership path."
        >
          {() => <div data-membership-categories />}
        </Field>
        <div class="join-application-identity-grid">
          <Field id="firstName" label="First name" errorSlot="firstName">
            {(control) => <TextInput {...control} name="firstName" autoComplete="given-name" required />}
          </Field>
          <Field id="lastName" label="Last name" errorSlot="applicantName">
            {(control) => <TextInput {...control} name="lastName" autoComplete="family-name" required />}
          </Field>
          <div data-organization-name-field>
            <Field
              id="organizationName"
              label="Organization name"
              errorSlot="organizationName"
              help="Use the legal or commonly recognized name of the organization you represent."
            >
              {(control) => <TextInput {...control} name="organizationName" autoComplete="organization" />}
            </Field>
          </div>
        </div>
        <div class="join-application-fields" data-custom-fields>
          <p class="pk-muted pk-small">Loading additional questions…</p>
        </div>
        <div class="membership-legal-agreements" data-membership-legal-agreements hidden>
          <div>
            <h3>Review and accept the membership terms</h3>
            <p class="pk-muted pk-small">
              Read each document in the scrollable panel, then confirm your agreement in its attached footer.
            </p>
          </div>
          {documents.map((document) => (
            <LegalAgreement key={document.key} document={document} />
          ))}
          <div class="membership-legal-authority" data-membership-legal-field="warranted_authority">
            <Field group label="Authority" errorSlot="warranted_authority">
              {() => (
                <Checkbox
                  name="custom.warranted_authority"
                  data-membership-legal-input
                  required
                  label={
                    <span data-membership-legal-label>
                      I represent and warrant that I have the necessary authority to submit this membership application
                      and to be legally bound by these terms.
                    </span>
                  }
                />
              )}
            </Field>
          </div>
        </div>
        <Button type="submit" variant="primary">
          Submit membership application
        </Button>
      </form>
    </div>
  );
}
