/**
 * Sponsor interest form — express interest, no payment.
 *
 * This is the generic consortium sponsor page (content/sponsors/sponsor.md),
 * which has no event context, so Path B self-service Stripe checkout isn't
 * wired up here — sponsorshipCheckoutSchema requires an eventId, and no
 * event-scoped sponsor page exists yet in Hugo to host that flow.
 *
 * No form_fields are seeded for sponsorship (only the membership application
 * form is portal-managed today), so this submits a fixed field set matching
 * sponsorshipInquirySchema — no generic custom-field rendering needed.
 */
import { postJson } from "../shared/api-client";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { readField, findSubmitButton } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";
import { replaceFormWithSuccess } from "../shared/form/success-panel";
import { sponsorshipInquirySchema } from "../../shared/schemas/sponsorship";

const API_BASE = "/api/v1";

/** Defaults a bare domain/path to https:// — mirrors the historic assets/js/form.js behavior. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export interface SponsorshipPayloadInput {
  contactName: string;
  contactEmail: string;
  organizationName: string;
  organizationWebsite?: string;
  desiredTier: string;
  comments?: string;
}

export function buildSponsorshipPayload(form: HTMLFormElement): SponsorshipPayloadInput {
  const firstName = readField(form, "firstName");
  const lastName = readField(form, "lastName");
  const website = normalizeUrl(readField(form, "organizationWebsite"));
  const comments = readField(form, "comments");

  return {
    contactName: [firstName, lastName].filter(Boolean).join(" "),
    contactEmail: readField(form, "email"),
    organizationName: readField(form, "organizationName"),
    organizationWebsite: website || undefined,
    desiredTier: readField(form, "desiredTier"),
    comments: comments || undefined,
  };
}

function showSuccessPanel(root: HTMLElement, form: HTMLFormElement): void {
  replaceFormWithSuccess(
    root,
    form,
    <SuccessPanel icon="🤝" title="Thanks for your interest!">
      <p class="event-flow-success-body">
        We&rsquo;ve received your sponsorship interest and emailed you our sponsorship brochure. A member of our team
        will follow up with you shortly.
      </p>
    </SuccessPanel>,
  );
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-sponsor-inquiry]");
  if (!root) return;
  const form = root.querySelector<HTMLFormElement>("#inputForm");
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");
  if (!form || !statusEl) return;

  installLiveValidation(form, statusEl);

  const websiteField = form.querySelector<HTMLInputElement>("#organizationWebsite");
  websiteField?.addEventListener("blur", () => {
    websiteField.value = normalizeUrl(websiteField.value);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    form.classList.add("was-validated");
    if (!validateBeforeSubmit(form, statusEl)) return;

    await withLoadingButton(findSubmitButton(form), async () => {
      try {
        const payload = sponsorshipInquirySchema.parse(buildSponsorshipPayload(form));
        await postJson(`${API_BASE}/sponsorship/inquiries`, payload);
        showSuccessPanel(root, form);
      } catch (error) {
        handleSubmitError(error, form, statusEl);
      }
    });
  });
}

void main();
