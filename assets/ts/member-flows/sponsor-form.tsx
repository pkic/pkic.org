/**
 * Sponsor interest form — express interest, no payment.
 *
 * This is the generic consortium sponsor page (content/sponsors/sponsor.md),
 * which has no event context, so Path B self-service Stripe checkout isn't
 * wired up here — sponsorshipCheckoutSchema requires an eventId, and no
 * event-scoped sponsor page exists yet in Hugo to host that flow.
 *
 * The form intentionally stays small, while the sponsorship tier vocabulary is
 * loaded from D1 so the page cannot drift from the configured catalog.
 */
import { getJson, postJson } from "../shared/api-client";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { handleSubmitError, withLoadingButton } from "../shared/form/submit";
import { findSubmitButton, readField, setStatus } from "../shared/form/helpers";
import { SuccessPanel } from "../components/SuccessPanel";
import { replaceFormWithSuccess } from "../shared/form/success-panel";
import {
  sponsorshipInquiryResponseSchema,
  sponsorshipInquirySchema,
  sponsorshipTiersResponseSchema,
  type SponsorshipInquiryInput,
} from "../../shared/schemas/sponsorship";

const API_BASE = "/api/v1";

/** Defaults a bare domain/path to https:// — mirrors the historic assets/js/form.js behavior. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

const NOT_SURE_TIER = "__not_sure__";

export type SponsorshipPayloadInput = SponsorshipInquiryInput;

function selectedTier(form: HTMLFormElement): string | null {
  const value = readField(form, "tier");
  return value === NOT_SURE_TIER ? null : value || null;
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
    tier: selectedTier(form),
    comments: comments || undefined,
  };
}

/** Populate the tier selector from the D1-backed catalog without trusting HTML values. */
export function populateTierOptions(select: HTMLSelectElement, tiers: string[]): void {
  select.replaceChildren();

  const placeholder = new Option("Select how you would like to sponsor", "", true, true);
  placeholder.disabled = true;
  select.append(placeholder);

  for (const tier of tiers) {
    const option = new Option(`We would like to become a ${tier} sponsor`, tier);
    select.append(option);
  }

  select.append(new Option("Not sure yet — contact me", NOT_SURE_TIER));
  select.disabled = false;
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
  const tierSelect = form?.elements.namedItem("tier");
  if (!form || !statusEl || !(tierSelect instanceof HTMLSelectElement)) return;

  const submitButton = findSubmitButton(form);
  if (submitButton) submitButton.disabled = true;

  try {
    const { tiers } = await getJson(
      `${API_BASE}/sponsors/tiers?sponsorType=consortium`,
      sponsorshipTiersResponseSchema,
    );
    populateTierOptions(
      tierSelect,
      tiers.map(({ tier }) => tier),
    );
    if (submitButton) submitButton.disabled = false;
  } catch {
    setStatus(statusEl, "Sponsorship options are temporarily unavailable. Please try again later.", true);
    return;
  }

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
        await postJson(`${API_BASE}/sponsors/inquiries`, payload, sponsorshipInquiryResponseSchema);
        showSuccessPanel(root, form);
      } catch (error) {
        handleSubmitError(error, form, statusEl);
      }
    });
  });
}

void main();
