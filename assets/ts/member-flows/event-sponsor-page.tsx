/**
 * "Sponsor Now" self-service Stripe Checkout — built for
 * the "event-scoped sponsor page" Hugo Frontend
 * requires an eventId and no event-scoped page existed to host it).
 *
 * On submit, POSTs to /api/v1/sponsors/checkouts and follows the
 * returned Stripe Checkout URL. No `sponsorships` row exists yet at this
 * point — it's created idempotently by the webhook once payment
 * completes (functions/api/v1/sponsors/checkouts/stripe.ts) — so there
 * is nothing to poll for locally; the post-redirect page is a static
 * thank-you (see content/events/2026/pqc-conference-amsterdam-nl/sponsors/complete/),
 * matching own "staff always confirm before any access is granted"
 * rule (a live status badge, like the donation flow's, isn't meaningful
 * here since payment alone never grants anything).
 */
import { getJson, postJson } from "../shared/api-client";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { readField, findSubmitButton, setStatus } from "../shared/form/helpers";
import { sponsorshipCheckoutResponseSchema, sponsorshipCheckoutSchema } from "../../shared/schemas/sponsorship";
import { publicSponsorTiersResponseSchema } from "../../shared/schemas/sponsors";

const API_BASE_FALLBACK = "/api/v1";

function currentBasePath(): string {
  const path = window.location.pathname;
  return path.endsWith("/") ? path : `${path}/`;
}

export async function initializeEventSponsorCheckout(root: HTMLElement): Promise<void> {
  const form = root.querySelector<HTMLFormElement>("#sponsorCheckoutForm");
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");
  if (!form || !statusEl) return;

  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const eventSlug = root.dataset.eventSlug ?? "";
  const tierSelect = form.elements.namedItem("tier");
  const submitButton = findSubmitButton(form);
  if (!(tierSelect instanceof HTMLSelectElement)) return;
  if (!eventSlug) {
    setStatus(statusEl, "This page is not configured with an event — sponsorship checkout is unavailable.", true);
    return;
  }
  try {
    const catalog = await getJson(`${apiBase}/sponsors/tiers?sponsorType=event`, publicSponsorTiersResponseSchema);
    if (catalog.sponsorType !== "event" || !catalog.tiers.length)
      throw new Error("Event sponsorship options unavailable");
    const placeholder = new Option("Select a sponsorship tier", "", true, true);
    placeholder.disabled = true;
    tierSelect.replaceChildren(placeholder);
    for (const { tier } of catalog.tiers) tierSelect.append(new Option(tier, tier));
    tierSelect.disabled = false;
    if (submitButton) submitButton.disabled = false;
  } catch {
    setStatus(statusEl, "Sponsorship options are temporarily unavailable. Please try again later.", true);
    return;
  }
  let checkoutAttemptId = crypto.randomUUID();

  form.addEventListener("input", () => {
    checkoutAttemptId = crypto.randomUUID();
  });

  installLiveValidation(form, statusEl);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    form.classList.add("was-validated");
    if (!eventSlug) {
      setStatus(statusEl, "This page is not configured with an event — sponsorship checkout is unavailable.", true);
      return;
    }
    if (!validateBeforeSubmit(form, statusEl)) return;

    await withLoadingButton(findSubmitButton(form), async () => {
      try {
        const firstName = readField(form, "firstName");
        const lastName = readField(form, "lastName");
        const organizationName = readField(form, "organizationName");
        const basePath = currentBasePath();

        const data = await postJson(
          `${apiBase}/sponsors/checkouts`,
          sponsorshipCheckoutSchema.parse({
            checkoutAttemptId,
            contactName: [firstName, lastName].filter(Boolean).join(" "),
            contactEmail: readField(form, "email"),
            organizationName: organizationName || undefined,
            tier: readField(form, "tier"),
            eventId: eventSlug,
            successPath: `${basePath}complete/`,
            cancelPath: basePath,
          }),
          sponsorshipCheckoutResponseSchema,
        );

        window.location.href = data.url;
      } catch (error) {
        handleSubmitError(error, form, statusEl);
      }
    });
  });
}

const root = document.querySelector<HTMLElement>("[data-event-sponsor-checkout]");
if (root) void initializeEventSponsorCheckout(root);
