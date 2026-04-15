import { render } from "preact";
import { getJson, patchJson, postJson } from "../shared/api-client";
import type { ProposalManageResponse } from "../shared/types";
import { normalizeValidation } from "../shared/form/validation-map";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form/validation";
import { withLoadingButton, handleSubmitError } from "../shared/form/submit";
import { bootstrap, setStatus } from "./boot";
import { readField, setField, formatStatusLabel, statusBadgeClass, q, findSubmitButton } from "../shared/form/helpers";

function tokenFromRoot(root: HTMLElement, fallback: string | null): string | null {
  const token = root.dataset.manageToken?.trim();
  return token || fallback;
}

function SpeakerList({ speakers }: { speakers: ProposalManageResponse["speakers"] }) {
  if (!speakers.length) {
    return <p class="text-muted small">No co-speakers added yet.</p>;
  }
  return (
    <>
      {speakers.map((s) => {
        const name = [s.firstName, s.lastName].filter(Boolean).join(" ") || s.email;
        const roleLabel = s.role.replace(/_/g, " ");
        return (
          <div key={s.userId} class="d-flex align-items-center gap-2 mb-1 small">
            <span class="badge bg-secondary text-capitalize">{roleLabel}</span>
            <span>{name}</span>
            <span class="text-muted">&lt;{s.email}&gt;</span>
            <span class={`badge rounded-pill px-2 py-1 ${statusBadgeClass(s.status)}`}>
              {formatStatusLabel(s.status)}
            </span>
            {s.status === "invited" && (
              <button type="button" class="btn btn-outline-secondary btn-sm" data-remind-user-id={s.userId}>
                Send reminder
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

function renderSpeakerList(speakers: ProposalManageResponse["speakers"]): void {
  const list = q("[data-cospeaker-list]");
  if (!list) return;
  render(<SpeakerList speakers={speakers} />, list as HTMLElement);
}

async function main(): Promise<void> {
  const boot = bootstrap("[data-event-proposal-manage]");
  if (!boot) {
    return;
  }
  installLiveValidation(boot.form, boot.statusEl);

  const token = tokenFromRoot(boot.root, boot.query.token);
  if (!token) {
    setStatus(boot.statusEl, "Missing manage token.", true);
    return;
  }

  let proposalData: ProposalManageResponse | null;

  try {
    proposalData = await getJson<ProposalManageResponse>(
      `${boot.apiBase}/proposals/manage/${encodeURIComponent(token)}`,
    );
    setField(boot.form, "proposalType", proposalData.proposal.proposal_type);
    setField(boot.form, "title", proposalData.proposal.title);
    setField(boot.form, "abstract", proposalData.proposal.abstract);
    setStatus(boot.statusEl, `Loaded proposal with status '${proposalData.proposal.status}'.`);
    renderSpeakerList(proposalData.speakers);
  } catch (error) {
    const normalized = normalizeValidation(error);
    setStatus(boot.statusEl, normalized.globalMessage, true);
    return;
  }

  boot.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    boot.form.classList.add("was-validated");
    if (!validateBeforeSubmit(boot.form, boot.statusEl)) return;

    await withLoadingButton(findSubmitButton(boot.form), async () => {
      try {
        const response = await patchJson<{ success: true; proposal: { status: string } }>(
          `${boot.apiBase}/proposals/manage/${encodeURIComponent(token)}`,
          {
            action: "update",
            proposalType: readField(boot.form, "proposalType"),
            title: readField(boot.form, "title"),
            abstract: readField(boot.form, "abstract"),
          },
        );
        setStatus(boot.statusEl, `Proposal updated. Current status: '${response.proposal.status}'.`);
      } catch (error) {
        handleSubmitError(error, boot.form, boot.statusEl);
      }
    });
  });

  const withdrawButton = boot.form.querySelector<HTMLButtonElement>("[data-action='withdraw']");
  withdrawButton?.addEventListener("click", async () => {
    try {
      const response = await patchJson<{ success: true; proposal: { status: string } }>(
        `${boot.apiBase}/proposals/manage/${encodeURIComponent(token)}`,
        { action: "withdraw" },
      );
      setStatus(boot.statusEl, `Proposal updated. Current status: '${response.proposal.status}'.`);
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(boot.statusEl, normalized.globalMessage, true);
    }
  });

  // Co-speaker invite
  const inviteBtn = q<HTMLButtonElement>("[data-cospeaker-invite-btn]", boot.root);
  const csStatus = q<HTMLElement>("[data-cospeaker-status]", boot.root);

  inviteBtn?.addEventListener("click", async () => {
    const email = (q<HTMLInputElement>("#cs-email", boot.root)?.value ?? "").trim();
    const firstName = (q<HTMLInputElement>("#cs-first-name", boot.root)?.value ?? "").trim() || undefined;
    const lastName = (q<HTMLInputElement>("#cs-last-name", boot.root)?.value ?? "").trim() || undefined;
    const role = q<HTMLSelectElement>("#cs-role", boot.root)?.value ?? "speaker";

    if (!email) {
      if (csStatus) {
        csStatus.textContent = "Please enter an email address.";
        csStatus.className = "mt-2 small text-danger";
      }
      return;
    }

    await withLoadingButton(inviteBtn, async () => {
      try {
        await postJson(`${boot.apiBase}/proposals/manage/${encodeURIComponent(token)}/speakers`, {
          email,
          firstName,
          lastName,
          role,
        });
        if (csStatus) {
          csStatus.textContent = `Invite sent to ${email}.`;
          csStatus.className = "mt-2 small text-success";
        }
        const emailEl = q<HTMLInputElement>("#cs-email", boot.root);
        const firstEl = q<HTMLInputElement>("#cs-first-name", boot.root);
        const lastEl = q<HTMLInputElement>("#cs-last-name", boot.root);
        if (emailEl) emailEl.value = "";
        if (firstEl) firstEl.value = "";
        if (lastEl) lastEl.value = "";
        const refreshed = await getJson<ProposalManageResponse>(
          `${boot.apiBase}/proposals/manage/${encodeURIComponent(token)}`,
        );
        renderSpeakerList(refreshed.speakers);
      } catch (error) {
        const normalized = normalizeValidation(error);
        if (csStatus) {
          csStatus.textContent = normalized.globalMessage;
          csStatus.className = "mt-2 small text-danger";
        }
      }
    });
  });

  boot.root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>("[data-remind-user-id]");
    if (!button) return;

    const userId = button.dataset.remindUserId;
    if (!userId) return;

    void (async () => {
      await withLoadingButton(button, async () => {
        try {
          await postJson(`${boot.apiBase}/proposals/manage/${encodeURIComponent(token)}/speakers/remind`, { userId });
          if (csStatus) {
            csStatus.textContent = "Reminder sent.";
            csStatus.className = "mt-2 small text-success";
          }
        } catch (error) {
          const normalized = normalizeValidation(error);
          if (csStatus) {
            csStatus.textContent = normalized.globalMessage;
            csStatus.className = "mt-2 small text-danger";
          }
        }
      });
    })();
  });
}

void main();
