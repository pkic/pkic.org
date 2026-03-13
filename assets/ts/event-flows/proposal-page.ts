import { getJson, postJson } from "../shared/api-client";
import { clearReferralSession } from "../shared/query-context";
import { applyFieldErrors, normalizeValidation } from "../shared/validation-map";
import { renderConsentInputs, readConsentValues } from "../shared/render-consents";
import { renderCustomFields, readCustomFieldValues } from "../shared/render-custom-fields";
import { renderProfileLinks, type ProfileLinksWidget } from "../shared/render-profile-links";
import { installStepNavigation } from "../shared/step-navigation";
import { renderSharePanel } from "../shared/render-share-panel";
import type { EventFormsResponse } from "../shared/types";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form-validation";
import { bootstrap, setStatus } from "./boot";

// ── Session type labels ───────────────────────────────────────────────────────

const SESSION_TYPE_LABELS: Record<string, string> = {
  talk: "Talk",
  keynote: "Keynote",
  panel: "Panel",
  workshop: "Workshop",
  tutorial: "Tutorial",
  lightning_talk: "Lightning talk",
  roundtable: "Roundtable",
  birds_of_a_feather: "Birds of a feather",
  fireside_chat: "Fireside chat",
  demo: "Demo",
};

/**
 * Renders session-type radio buttons into the [data-session-types] container.
 * The first type in the list is pre-selected.
 */
function renderSessionTypes(root: HTMLElement, types: string[]): void {
  const container = root.querySelector<HTMLElement>("[data-session-types]");
  if (!container) return;
  container.innerHTML = "";
  types.forEach((type, i) => {
    const id = `type-${type}`;
    const label = SESSION_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
    const radio = document.createElement("input");
    radio.className = "btn-check";
    radio.type = "radio";
    radio.name = "proposalType";
    radio.id = id;
    radio.value = type;
    if (i === 0) radio.checked = true;
    const lbl = document.createElement("label");
    lbl.className = "btn btn-outline-secondary btn-sm";
    lbl.htmlFor = id;
    lbl.textContent = label;
    container.append(radio, lbl);
  });
}

// ── Speaker tracking ──────────────────────────────────────────────────────────

interface SpeakerEntry {
  index: number;
  linksWidget: ProfileLinksWidget;
}

/** All additional speaker cards (not the proposer). */
const additionalSpeakers: SpeakerEntry[] = [];
let speakerCount = 0;

/** Profile links widget for the proposer when they are also presenting. */
let proposerLinksWidget: ProfileLinksWidget | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function read(form: HTMLFormElement, key: string): string {
  const input = form.elements.namedItem(key);
  if (
    !(
      input instanceof HTMLInputElement ||
      input instanceof HTMLSelectElement ||
      input instanceof HTMLTextAreaElement
    )
  ) {
    return "";
  }
  return input.value.trim();
}

function readRadio(container: HTMLElement, name: string): string {
  const checked = container.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return checked?.value ?? "";
}

// ── Shared SVG snippets ───────────────────────────────────────────────────────

const SVG_PLUS =
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" ` +
  `viewBox="0 0 16 16" aria-hidden="true">` +
  `<path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>` +
  `</svg>`;

// ── Speaker card builder ──────────────────────────────────────────────────────

/**
 * Builds the proposer's speaker card (shown only when "I am also presenting" is checked).
 * Bio and profile links are collected here; the proposer's name/email/org/title
 * are pre-filled from step 1 and editable in-place.
 * The backend always records the proposer with role "proposer".
 */
function createProposerCard(): { el: HTMLElement; linksWidget: ProfileLinksWidget } {
  const wrapper = document.createElement("div");
  wrapper.className = "proposal-speaker-card";
  wrapper.dataset.proposerCard = "true";

  const head = document.createElement("div");
  head.className = "proposal-speaker-card-head";
  const titleEl = document.createElement("span");
  titleEl.className = "proposal-speaker-card-title";
  titleEl.textContent = "You — as a speaker";
  head.append(titleEl);
  wrapper.append(head);

  const body = document.createElement("div");
  body.className = "row g-3 mt-0";
  body.innerHTML = `
    <div class="col-sm-6">
      <label class="form-label" for="pspk-first">First name</label>
      <input id="pspk-first" name="proposerSpeakerFirstName" type="text" class="form-control" required autocomplete="given-name">
    </div>
    <div class="col-sm-6">
      <label class="form-label" for="pspk-last">Last name</label>
      <input id="pspk-last" name="proposerSpeakerLastName" type="text" class="form-control" required autocomplete="family-name">
    </div>
    <div class="col-12">
      <label class="form-label" for="pspk-email">Email</label>
      <input id="pspk-email" name="proposerSpeakerEmail" type="email" class="form-control" required autocomplete="email">
      <div class="form-text">
        Your management link is sent here. You will also receive a personal link to confirm your
        participation once the proposal is submitted.
      </div>
    </div>
    <div class="col-sm-6">
      <label class="form-label" for="pspk-org">
        Organization <span class="text-muted fw-normal small">(optional)</span>
      </label>
      <input id="pspk-org" name="proposerSpeakerOrg" type="text" class="form-control" autocomplete="organization">
    </div>
    <div class="col-sm-6">
      <label class="form-label" for="pspk-title">
        Job title <span class="text-muted fw-normal small">(optional)</span>
      </label>
      <input id="pspk-title" name="proposerSpeakerTitle" type="text" class="form-control" autocomplete="organization-title">
    </div>
    <div class="col-12">
      <label class="form-label" for="pspk-bio">Bio</label>
      <textarea id="pspk-bio" name="proposerBio" rows="4" class="form-control" required
        minlength="40" maxlength="5000"></textarea>
      <div class="form-text">
        A short professional biography as you would like it to appear on the event website
        if your proposal is accepted.
      </div>
      <div data-field-error="proposer.bio" class="invalid-feedback d-block"></div>
    </div>
    <div class="col-12">
      <label class="form-label">
        Profile links <span class="text-muted fw-normal small">(optional)</span>
      </label>
      <div data-proposer-links></div>
    </div>
  `;

  wrapper.append(body);

  const linksContainer = body.querySelector<HTMLElement>("[data-proposer-links]");
  const widget = renderProfileLinks(linksContainer!, "proposerLink");

  return { el: wrapper, linksWidget: widget };
}

/**
 * Builds a speaker card for an additional (non-proposer) speaker.
 * Index must be >= 1; index 0 is reserved for the proposer card.
 */
function createSpeakerCard(index: number): { el: HTMLElement; linksWidget: ProfileLinksWidget } {
  const wrapper = document.createElement("div");
  wrapper.className = "proposal-speaker-card";
  wrapper.dataset.index = String(index);

  const head = document.createElement("div");
  head.className = "proposal-speaker-card-head";

  const titleEl = document.createElement("span");
  titleEl.className = "proposal-speaker-card-title";
  titleEl.textContent = `Speaker ${index}`;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn btn-link btn-sm text-danger p-0";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    wrapper.remove();
    const idx = additionalSpeakers.findIndex((s) => s.index === index);
    if (idx !== -1) additionalSpeakers.splice(idx, 1);
  });

  head.append(titleEl, removeBtn);
  wrapper.append(head);

  const body = document.createElement("div");
  body.className = "row g-3 mt-0";
  body.innerHTML = `
    <div class="col-sm-6">
      <label class="form-label" for="spk-${index}-first">First name</label>
      <input id="spk-${index}-first" name="speaker.${index}.firstName" type="text"
        class="form-control" required>
      <div data-field-error="speakers.${index}.firstName" class="invalid-feedback d-block"></div>
    </div>
    <div class="col-sm-6">
      <label class="form-label" for="spk-${index}-last">Last name</label>
      <input id="spk-${index}-last" name="speaker.${index}.lastName" type="text"
        class="form-control" required>
      <div data-field-error="speakers.${index}.lastName" class="invalid-feedback d-block"></div>
    </div>
    <div class="col-12">
      <label class="form-label" for="spk-${index}-email">Email</label>
      <input id="spk-${index}-email" name="speaker.${index}.email" type="email"
        class="form-control" required>
      <div class="form-text">
        This person will receive a personal link to confirm their participation and complete their
        speaker profile.
      </div>
      <div data-field-error="speakers.${index}.email" class="invalid-feedback d-block"></div>
    </div>
    <div class="col-sm-6">
      <label class="form-label" for="spk-${index}-org">
        Organization <span class="text-muted fw-normal small">(optional)</span>
      </label>
      <input id="spk-${index}-org" name="speaker.${index}.organizationName" type="text"
        class="form-control">
    </div>
    <div class="col-sm-6">
      <label class="form-label" for="spk-${index}-title">
        Job title <span class="text-muted fw-normal small">(optional)</span>
      </label>
      <input id="spk-${index}-title" name="speaker.${index}.jobTitle" type="text"
        class="form-control">
    </div>
    <div class="col-12">
      <label class="form-label" for="spk-${index}-bio">Bio</label>
      <textarea id="spk-${index}-bio" name="speaker.${index}.bio" rows="4"
        class="form-control" required minlength="40" maxlength="5000"></textarea>
      <div class="form-text">
        A short professional biography as it would appear on the event website if accepted.
      </div>
      <div data-field-error="speakers.${index}.bio" class="invalid-feedback d-block"></div>
    </div>
    <div class="col-12">
      <label class="form-label">Role</label>
      <div class="event-flow-role-options" role="group" aria-label="Speaker role">
        <input class="btn-check" type="radio" name="speaker.${index}.role"
          id="role-${index}-speaker"   value="speaker"    checked>
        <label class="btn btn-outline-secondary btn-sm" for="role-${index}-speaker">Speaker</label>

        <input class="btn-check" type="radio" name="speaker.${index}.role"
          id="role-${index}-cospeaker" value="co_speaker">
        <label class="btn btn-outline-secondary btn-sm" for="role-${index}-cospeaker">Co-speaker</label>

        <input class="btn-check" type="radio" name="speaker.${index}.role"
          id="role-${index}-moderator" value="moderator">
        <label class="btn btn-outline-secondary btn-sm" for="role-${index}-moderator">Moderator</label>

        <input class="btn-check" type="radio" name="speaker.${index}.role"
          id="role-${index}-panelist"  value="panelist">
        <label class="btn btn-outline-secondary btn-sm" for="role-${index}-panelist">Panelist</label>
      </div>
    </div>
    <div class="col-12">
      <label class="form-label">
        Profile links <span class="text-muted fw-normal small">(optional)</span>
      </label>
      <div data-speaker-links="${index}"></div>
    </div>
  `;

  wrapper.append(body);

  const linksContainer = body.querySelector<HTMLElement>(`[data-speaker-links="${index}"]`);
  const linksWidget = renderProfileLinks(linksContainer!, `speaker.${index}.links`);

  return { el: wrapper, linksWidget };
}

// ── Payload builder ───────────────────────────────────────────────────────────

function readAdditionalSpeakers(form: HTMLFormElement) {
  return additionalSpeakers
    .map(({ index, linksWidget }) => {
      const email = read(form, `speaker.${index}.email`);
      if (!email) return null;

      const card = form.querySelector<HTMLElement>(`.proposal-speaker-card[data-index="${index}"]`);
      const role = card ? readRadio(card, `speaker.${index}.role`) || "speaker" : "speaker";

      return {
        role,
        firstName: read(form, `speaker.${index}.firstName`),
        lastName: read(form, `speaker.${index}.lastName`),
        email,
        organizationName: read(form, `speaker.${index}.organizationName`) || undefined,
        jobTitle: read(form, `speaker.${index}.jobTitle`) || undefined,
        bio: read(form, `speaker.${index}.bio`),
        links: linksWidget.getLinks(),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

// ── Post-submission panel ─────────────────────────────────────────────────────

/**
 * Shows the proposal success state.
 *
 * Psychology:
 * - Zeigarnik Effect: the "check your email" CTA creates productive tension.
 * - Reciprocity + Peak-End: the share nudge at the end frames the submission
 *   as a community contribution, making that the most memorable moment.
 */
function showSuccessPanel(
  root: HTMLElement,
  form: HTMLFormElement,
  result: { success: boolean; status: string; manageUrl?: string },
  firstName: string,
  eventName: string,
  eventSlug: string,
): void {
  form.classList.add("d-none");

  const panel = document.createElement("div");
  panel.className = "event-flow-success";
  panel.innerHTML = `
    <div class="event-flow-success-icon" aria-hidden="true">📋</div>
    <h2 class="event-flow-success-title">Proposal submitted${firstName ? `, ${firstName}` : ""}!</h2>
    <p class="event-flow-success-body">
      Your proposal is now under review. The programme committee will be in touch by email
      with a decision.
    </p>
    ${
      result.manageUrl
        ? `<p><a href="${result.manageUrl}" class="btn btn-outline-secondary btn-sm">Manage your proposal →</a></p>`
        : ""
    }
    <p class="text-muted small">
      Speakers you listed will each receive a personal email with a private link to confirm
      their participation, complete their profile, and upload a headshot once accepted.
      If there is context about additional potential speakers, include that in your proposal notes or follow up with the programme team.
    </p>
  `;

  // Invite colleagues to attend — share panel mirrors the registration flow
  const shareContainer = document.createElement("div");
  renderSharePanel(shareContainer, {
    shareUrl: `https://pkic.org/events/${eventSlug}/`,
    eventName,
    firstName: firstName || null,
  });
  panel.appendChild(shareContainer);

  root.appendChild(panel);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-proposal]");
  if (!boot) return;

  const { form, statusEl, eventSlug, eventPagePath, apiBase, query } = boot;
  const eventPathHeaders = eventPagePath ? { "x-event-base-path": eventPagePath } : undefined;

  installLiveValidation(form, statusEl);

  const consentsContainer = boot.root.querySelector<HTMLElement>("[data-consents]");
  const customFieldsContainer = boot.root.querySelector<HTMLElement>("[data-custom-fields]");
  const speakersContainer = boot.root.querySelector<HTMLElement>("[data-proposal-speakers]");
  const addSpeakerBtn = boot.root.querySelector<HTMLButtonElement>("[data-add-speaker]");
  const isPresentingCheckbox = form.querySelector<HTMLInputElement>("#proposal-is-presenting");

  let eventName = eventSlug;

  // ── Proposer speaker card management ─────────────────────────────────────

  let proposerCardEl: HTMLElement | null = null;

  function ensureProposerCard(): void {
    if (proposerCardEl || !speakersContainer) return;
    const { el, linksWidget } = createProposerCard();
    proposerCardEl = el;
    proposerLinksWidget = linksWidget;
    speakersContainer.prepend(el);
    prefillProposerCard();
  }

  function removeProposerCard(): void {
    if (!proposerCardEl) return;
    proposerCardEl.remove();
    proposerCardEl = null;
    proposerLinksWidget = null;
  }

  function prefillProposerCard(): void {
    if (!proposerCardEl) return;
    const setIfEmpty = (name: string, value: string) => {
      const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
      if (el && !el.value) el.value = value;
    };
    setIfEmpty("proposerSpeakerFirstName", read(form, "firstName"));
    setIfEmpty("proposerSpeakerLastName", read(form, "lastName"));
    setIfEmpty("proposerSpeakerEmail", read(form, "email"));
    setIfEmpty("proposerSpeakerOrg", read(form, "organizationName"));
    setIfEmpty("proposerSpeakerTitle", read(form, "jobTitle"));
  }

  isPresentingCheckbox?.addEventListener("change", () => {
    if (isPresentingCheckbox.checked) {
      ensureProposerCard();
    } else {
      removeProposerCard();
    }
  });

  // ── Step navigation — pre-fill proposer card when entering step 3 ─────────

  installStepNavigation(boot.root, form, statusEl, (currentStep) => {
    if (currentStep === 3 && isPresentingCheckbox?.checked) {
      ensureProposerCard();
      prefillProposerCard();
    }
  });

  // ── Add speaker button ────────────────────────────────────────────────────

  addSpeakerBtn?.addEventListener("click", () => {
    if (!speakersContainer) return;
    speakerCount += 1;
    const { el, linksWidget } = createSpeakerCard(speakerCount);
    additionalSpeakers.push({ index: speakerCount, linksWidget });
    speakersContainer.append(el);
  });

  // ── Load form metadata ────────────────────────────────────────────────────

  try {
    const forms = await getJson<EventFormsResponse>(
      `${apiBase}/events/${eventSlug}/forms?purpose=proposal_submission`,
    );
    eventName = forms.event.name;
    if (consentsContainer) renderConsentInputs(consentsContainer, forms.requiredTerms);
    renderSessionTypes(boot.root, forms.allowedSessionTypes ?? ["talk", "keynote", "panel"]);
    if (customFieldsContainer && forms.form) {
      renderCustomFields(customFieldsContainer, forms.form.fields);
    }
  } catch {
    setStatus(statusEl, "Could not load proposal form details.", true);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    form.classList.add("was-validated");
    if (!validateBeforeSubmit(form, statusEl)) return;

    const submit = form.querySelector<HTMLButtonElement>("button[type='submit']");
    if (submit) submit.disabled = true;

    try {
      const isPresenting = isPresentingCheckbox?.checked ?? false;
      const firstName = read(form, "firstName");

      const payload = {
        inviteToken: query.inviteToken ?? undefined,
        sourceType: query.sourceType ?? "direct",
        sourceRef: query.sourceType ?? undefined,
        referralCode: query.referralCode ?? undefined,

        // Contact / proposer — bio + links only if they are also presenting
        proposer: {
          firstName,
          lastName: read(form, "lastName"),
          email: read(form, "email"),
          organizationName: read(form, "organizationName") || undefined,
          jobTitle: read(form, "jobTitle") || undefined,
          bio: isPresenting ? read(form, "proposerBio") || undefined : undefined,
          links: isPresenting && proposerLinksWidget ? proposerLinksWidget.getLinks() : [],
        },

        proposal: {
          type: read(form, "proposalType") || "talk",
          title: read(form, "title"),
          abstract: read(form, "abstract"),
          details: readCustomFieldValues(form),
        },

        // Additional speakers only (proposer is handled separately above)
        speakers: readAdditionalSpeakers(form),

        consents: readConsentValues(form),
      };

      const result = await postJson<{ success: boolean; status: string; manageUrl?: string }>(
        `${apiBase}/events/${eventSlug}/proposals`,
        payload,
        eventPathHeaders,
      );

      clearReferralSession();
      showSuccessPanel(boot.root, form, result, firstName, eventName, eventSlug);
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(statusEl, normalized.globalMessage, true);
      applyFieldErrors(form, normalized.fields);
    } finally {
      const submit = form.querySelector<HTMLButtonElement>("button[type='submit']");
      if (submit) submit.disabled = false;
    }
  });
}

void main();

