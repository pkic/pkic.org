import { getJson, patchJson } from "../shared/api-client";
import type { ProposalManageResponse } from "../shared/types";
import { applyFieldErrors, normalizeValidation } from "../shared/validation-map";
import { installLiveValidation, validateBeforeSubmit } from "../shared/form-validation";
import { bootstrap, setStatus } from "./boot";

function tokenFromRoot(root: HTMLElement, fallback: string | null): string | null {
  const token = root.dataset.manageToken?.trim();
  return token || fallback;
}

function fill(form: HTMLFormElement, key: string, value: string): void {
  const field = form.elements.namedItem(key);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    field.value = value;
  }
}

function read(form: HTMLFormElement, key: string): string {
  const field = form.elements.namedItem(key);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    return field.value.trim();
  }
  return "";
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

  try {
    const data = await getJson<ProposalManageResponse>(`${boot.apiBase}/proposals/manage/${encodeURIComponent(token)}`);
    fill(boot.form, "proposalType", data.proposal.proposal_type);
    fill(boot.form, "title", data.proposal.title);
    fill(boot.form, "abstract", data.proposal.abstract);
    setStatus(boot.statusEl, `Loaded proposal with status '${data.proposal.status}'.`);
  } catch (error) {
    const normalized = normalizeValidation(error);
    setStatus(boot.statusEl, normalized.globalMessage, true);
    return;
  }

  boot.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    boot.form.classList.add("was-validated");
    if (!validateBeforeSubmit(boot.form, boot.statusEl)) {
      return;
    }

    const submit = boot.form.querySelector<HTMLButtonElement>("button[type='submit']");
    if (submit) {
      submit.disabled = true;
    }

    try {
      const response = await patchJson<{ success: true; proposal: { status: string } }>(
        `${boot.apiBase}/proposals/manage/${encodeURIComponent(token)}`,
        {
          action: "update",
          proposalType: read(boot.form, "proposalType"),
          title: read(boot.form, "title"),
          abstract: read(boot.form, "abstract"),
        },
      );
      setStatus(boot.statusEl, `Proposal updated. Current status: '${response.proposal.status}'.`);
    } catch (error) {
      const normalized = normalizeValidation(error);
      setStatus(boot.statusEl, normalized.globalMessage, true);
      applyFieldErrors(boot.form, normalized.fields);
    } finally {
      if (submit) {
        submit.disabled = false;
      }
    }
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
}

void main();
