import { render } from "preact";
import { postJson } from "../api-client";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { resetButton, setButtonLoading } from "../form/button-loading";

interface ManageLinkRecoveryOptions {
  root: HTMLElement;
  loadingSelector: string;
  sectionSelector: string;
  buttonSelector: string;
  statusSelector: string;
  emailSelector: string;
  endpoint: string;
  successMessage: string;
  introMessage?: string;
}

export function showManageLinkRecoveryForm(options: ManageLinkRecoveryOptions): void {
  const {
    root,
    loadingSelector,
    sectionSelector,
    buttonSelector,
    statusSelector,
    emailSelector,
    endpoint,
    successMessage,
    introMessage,
  } = options;

  const loadingEl = root.querySelector<HTMLElement>(loadingSelector);
  const sectionEl = root.querySelector<HTMLElement>(sectionSelector);
  const resendBtn = root.querySelector<HTMLButtonElement>(buttonSelector);
  const statusEl = root.querySelector<HTMLElement>(statusSelector);
  const emailInput = root.querySelector<HTMLInputElement>(emailSelector);

  // `hidden` is what the migrated templates use; the `d-none` toggle is still
  // needed by the flows that have not moved yet.
  if (loadingEl) {
    loadingEl.hidden = true;
    loadingEl.classList.add("d-none");
  }
  if (sectionEl) {
    sectionEl.hidden = false;
    sectionEl.classList.remove("d-none");
  }

  if (introMessage && statusEl) {
    statusEl.textContent = introMessage;
    statusEl.className = "pk-small";
  }

  if (!resendBtn) return;
  if (resendBtn.dataset.bound === "1") return;
  resendBtn.dataset.bound = "1";

  resendBtn.addEventListener("click", async () => {
    const email = emailInput?.value.trim() ?? "";
    if (!email) {
      if (statusEl) {
        statusEl.textContent = "Please enter your email address.";
        statusEl.className = "pk-alert pk-alert--danger";
      }
      return;
    }

    setButtonLoading(resendBtn);
    try {
      await postJson(endpoint, { email }, successResponseSchema);
      if (sectionEl) {
        render(<p class="pk-alert pk-alert--ok">{successMessage}</p>, sectionEl);
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = "Something went wrong. Please try again.";
        statusEl.className = "pk-alert pk-alert--danger";
      }
      resetButton(resendBtn);
    }
  });
}
