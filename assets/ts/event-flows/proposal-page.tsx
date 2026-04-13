import { render, createRef } from "preact";
import { getJson, postJson } from "../shared/api-client";
import { clearReferralSession } from "../shared/query-context";
import { renderConsentInputs, readConsentValues, syncConsentValidation } from "../shared/widgets/consents";
import { renderCustomFields, readCustomFieldValues } from "../shared/widgets/custom-fields";
import { installStepNavigation } from "../shared/form/step-navigation";
import { renderSharePanel } from "../shared/widgets/share-panel";
import type { EventFormsResponse } from "../shared/types";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import { proposalCreateSchema } from "../../shared/schemas/api";
import { readField, findSubmitButton } from "../shared/form/helpers";
import { SpeakerFormCard } from "../components/SpeakerFormCard";
import { SuccessPanel } from "../components/SuccessPanel";
import type { ProfileLinksHandle } from "../components/ProfileLinksInput";

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
  render(
    <>
      {types.map((type, i) => {
        const id = `type-${type}`;
        const label = SESSION_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
        return (
          <>
            <input class="btn-check" type="radio" name="proposalType" id={id} value={type} checked={i === 0} />
            <label class="btn btn-outline-secondary btn-sm" htmlFor={id}>{label}</label>
          </>
        );
      })}
    </>,
    container,
  );
}

// ── Speaker tracking ──────────────────────────────────────────────────────────

interface SpeakerEntry {
  index: number;
  container: HTMLElement;
  linksRef: ReturnType<typeof createRef<ProfileLinksHandle>>;
}

/** All additional speaker cards (not the proposer). */
const additionalSpeakers: SpeakerEntry[] = [];
let speakerCount = 0;

/** Profile links ref for the proposer when they are also presenting. */
let proposerLinksRef: ReturnType<typeof createRef<ProfileLinksHandle>> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function readRadio(container: HTMLElement, name: string): string {
  const checked = container.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return checked?.value ?? "";
}

// ── Speaker card builder ──────────────────────────────────────────────────────

/**
 * Builds the proposer's speaker card (shown only when "I am also presenting" is checked).
 * Bio and profile links are collected here; the proposer's name/email/org/title
 * are pre-filled from step 1 and editable in-place.
 * The backend always records the proposer with role "proposer".
 */
function createProposerCard(): { el: HTMLElement; linksRef: ReturnType<typeof createRef<ProfileLinksHandle>> } {
  const container = document.createElement("div");
  const linksRef = createRef<ProfileLinksHandle>();
  render(
    <SpeakerFormCard
      title="You — as a speaker"
      idPrefix="pspk"
      fields={{
        firstName: "proposerSpeakerFirstName",
        lastName: "proposerSpeakerLastName",
        email: "proposerSpeakerEmail",
        organizationName: "proposerSpeakerOrg",
        jobTitle: "proposerSpeakerTitle",
        bio: "proposerBio",
      }}
      linksFieldName="proposerLink"
      linksRef={linksRef}
      emailHelp="Your management link is sent here. You will also receive a personal link to confirm your participation once the proposal is submitted."
      bioHelp="A short professional biography as you would like it to appear on the event website if your proposal is accepted."
      autocomplete
      errorPaths={{ bio: "proposer.bio" }}
    />,
    container,
  );
  return { el: container, linksRef };
}

/**
 * Builds a speaker card for an additional (non-proposer) speaker.
 * Index must be >= 1; index 0 is reserved for the proposer card.
 */
function createSpeakerCard(index: number): { el: HTMLElement; linksRef: ReturnType<typeof createRef<ProfileLinksHandle>> } {
  const container = document.createElement("div");
  const linksRef = createRef<ProfileLinksHandle>();
  const handleRemove = () => {
    render(null, container);
    container.remove();
    const idx = additionalSpeakers.findIndex((s) => s.index === index);
    if (idx !== -1) additionalSpeakers.splice(idx, 1);
  };
  render(
    <SpeakerFormCard
      title={`Speaker ${index}`}
      idPrefix={`spk-${index}`}
      fields={{
        firstName: `speaker.${index}.firstName`,
        lastName: `speaker.${index}.lastName`,
        email: `speaker.${index}.email`,
        organizationName: `speaker.${index}.organizationName`,
        jobTitle: `speaker.${index}.jobTitle`,
        bio: `speaker.${index}.bio`,
        role: `speaker.${index}.role`,
      }}
      linksFieldName={`speaker.${index}.links`}
      linksRef={linksRef}
      emailHelp="This person will receive a personal link to confirm their participation and complete their speaker profile."
      bioHelp="A short professional biography as it would appear on the event website if accepted."
      errorPaths={{
        firstName: `speakers.${index}.firstName`,
        lastName: `speakers.${index}.lastName`,
        email: `speakers.${index}.email`,
        bio: `speakers.${index}.bio`,
      }}
      onRemove={handleRemove}
    />,
    container,
  );
  return { el: container, linksRef };
}

// ── Payload builder ───────────────────────────────────────────────────────────

function readAdditionalSpeakers(form: HTMLFormElement) {
  return additionalSpeakers
    .map(({ index, linksRef }) => {
      const email = readField(form, `speaker.${index}.email`);
      if (!email) return null;

      const role = readRadio(form, `speaker.${index}.role`) || "speaker";

      return {
        role,
        firstName: readField(form, `speaker.${index}.firstName`),
        lastName: readField(form, `speaker.${index}.lastName`),
        email,
        organizationName: readField(form, `speaker.${index}.organizationName`) || undefined,
        jobTitle: readField(form, `speaker.${index}.jobTitle`) || undefined,
        bio: readField(form, `speaker.${index}.bio`),
        links: linksRef.current?.getLinks() ?? [],
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

  const container = document.createElement("div");
  const shareRef = createRef<HTMLDivElement>();
  const title = `Proposal submitted${firstName ? `, ${firstName}` : ""}!`;

  render(
    <SuccessPanel icon="📋" title={title}>
      <p class="event-flow-success-body">
        Your proposal is now under review. The programme committee will be in touch by email
        with a decision.
      </p>
      {result.manageUrl && (
        <p>
          <a href={result.manageUrl} class="btn btn-outline-secondary btn-sm">
            Manage your proposal →
          </a>
        </p>
      )}
      <p class="text-muted small">
        Speakers you listed will each receive a personal email with a private link to confirm
        their participation, complete their profile, and upload a headshot once accepted.
        If there is context about additional potential speakers, include that in your proposal notes or follow up with the programme team.
      </p>
      <div ref={shareRef} />
    </SuccessPanel>,
    container,
  );

  if (shareRef.current) {
    renderSharePanel(shareRef.current, {
      shareUrl: `https://pkic.org/events/${eventSlug}/`,
      eventName,
      firstName: firstName || null,
    });
  }

  root.appendChild(container);
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
    const { el, linksRef } = createProposerCard();
    proposerCardEl = el;
    proposerLinksRef = linksRef;
    speakersContainer.prepend(el);
    prefillProposerCard();
  }

  function removeProposerCard(): void {
    if (!proposerCardEl) return;
    render(null, proposerCardEl);
    proposerCardEl.remove();
    proposerCardEl = null;
    proposerLinksRef = null;
  }

  function prefillProposerCard(): void {
    if (!proposerCardEl) return;
    const setIfEmpty = (name: string, value: string) => {
      const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
      if (el && !el.value) el.value = value;
    };
    setIfEmpty("proposerSpeakerFirstName", readField(form, "firstName"));
    setIfEmpty("proposerSpeakerLastName", readField(form, "lastName"));
    setIfEmpty("proposerSpeakerEmail", readField(form, "email"));
    setIfEmpty("proposerSpeakerOrg", readField(form, "organizationName"));
    setIfEmpty("proposerSpeakerTitle", readField(form, "jobTitle"));
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
    const { el, linksRef } = createSpeakerCard(speakerCount);
    additionalSpeakers.push({ index: speakerCount, container: el, linksRef });
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
    syncConsentValidation(form);
    if (!validateBeforeSubmit(form, statusEl)) return;

    await withLoadingButton(findSubmitButton(form), async () => {
      try {
        const isPresenting = isPresentingCheckbox?.checked ?? false;
        const firstName = readField(form, "firstName");

        const payload = proposalCreateSchema.parse({
          inviteToken: query.inviteToken ?? undefined,
          sourceType: query.sourceType ?? "direct",
          sourceRef: query.sourceType ?? undefined,
          referralCode: query.referralCode ?? undefined,

          proposer: {
            firstName,
            lastName: readField(form, "lastName"),
            email: readField(form, "email"),
            organizationName: readField(form, "organizationName") || undefined,
            jobTitle: readField(form, "jobTitle") || undefined,
            bio: isPresenting ? readField(form, "proposerBio") || undefined : undefined,
            links: isPresenting && proposerLinksRef?.current ? proposerLinksRef.current.getLinks() : [],
          },

          proposal: {
            type: readField(form, "proposalType") || "talk",
            title: readField(form, "title"),
            abstract: readField(form, "abstract"),
            details: readCustomFieldValues(form),
          },

          speakers: readAdditionalSpeakers(form),
          consents: readConsentValues(form),
        });

        const result = await postJson<{ success: boolean; status: string; manageUrl?: string }>(
          `${apiBase}/events/${eventSlug}/proposals`,
          payload,
          eventPathHeaders,
        );

        clearReferralSession();
        showSuccessPanel(boot.root, form, result, firstName, eventName, eventSlug);
      } catch (error) {
        handleSubmitError(error, form, statusEl);
      }
    });
  });
}

void main();

