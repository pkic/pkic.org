import { postJson } from "./api-client";
import { resetButton, setButtonLoading } from "./button-loading";

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

  if (loadingEl) loadingEl.classList.add("d-none");
  if (sectionEl) sectionEl.classList.remove("d-none");

  if (introMessage && statusEl) {
    statusEl.textContent = introMessage;
    statusEl.className = "mt-2 small text-muted";
  }

  if (!resendBtn) return;
  if (resendBtn.dataset.bound === "1") return;
  resendBtn.dataset.bound = "1";

  resendBtn.addEventListener("click", async () => {
    const email = emailInput?.value.trim() ?? "";
    if (!email) {
      if (statusEl) {
        statusEl.textContent = "Please enter your email address.";
        statusEl.className = "mt-2 small text-danger";
      }
      return;
    }

    setButtonLoading(resendBtn);
    try {
      await postJson(endpoint, { email });
      if (sectionEl) {
        sectionEl.innerHTML = `<p class="alert alert-success">${successMessage}</p>`;
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = "Something went wrong. Please try again.";
        statusEl.className = "mt-2 small text-danger";
      }
      resetButton(resendBtn);
    }
  });
}