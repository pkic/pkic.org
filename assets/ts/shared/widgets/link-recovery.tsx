import { postJson } from "../api-client";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { clearButtonBusy, isButtonBusy, setButtonBusy } from "../form/button-busy";
// The status line is an element the template already rendered, so its tone is
// written here as class names rather than reached through `Alert`. Component
// CSS ships in a lazy chunk, so this module has to pull the stylesheet into
// its own or the classes render unstyled.
import "../../ui/Alert.css";

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

/**
 * Says something in the status line the template left empty.
 *
 * The tone used to be the whole message: a red block and nothing else. A
 * status that is only a color is not a status, so the element takes a live
 * region role as well — `alert` for a failure, which interrupts, and `status`
 * for the opening explanation, which does not — and the words say which it is.
 */
function announce(statusEl: HTMLElement, message: string, tone: "intro" | "danger" | "success"): void {
  statusEl.textContent = message;
  statusEl.className =
    tone === "danger" ? "pk-alert pk-alert--danger" : tone === "success" ? "pk-alert pk-alert--ok" : "pk-small";
  statusEl.setAttribute("role", tone === "danger" ? "alert" : "status");
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

  // Visibility is the `hidden` attribute the templates already carry, on both
  // sides. It used to toggle `d-none` as well, for the flows that had not
  // moved; the last of those — `event-speaker-manage.html` — moved with this
  // change, so the class is gone rather than kept as a second switch that
  // could disagree with the attribute.
  if (loadingEl) loadingEl.hidden = true;
  if (sectionEl) sectionEl.hidden = false;

  if (introMessage && statusEl) announce(statusEl, introMessage, "intro");

  if (!resendBtn) return;
  if (resendBtn.dataset.bound === "1") return;
  resendBtn.dataset.bound = "1";

  resendBtn.addEventListener("click", () => {
    if (isButtonBusy(resendBtn)) return;
    const email = emailInput?.value.trim() ?? "";
    if (!email) {
      if (statusEl) announce(statusEl, "Please enter your email address.", "danger");
      emailInput?.setAttribute("aria-invalid", "true");
      emailInput?.focus();
      return;
    }
    emailInput?.removeAttribute("aria-invalid");

    setButtonBusy(resendBtn);
    void (async () => {
      try {
        await postJson(endpoint, { email }, successResponseSchema);
        if (statusEl) announce(statusEl, successMessage, "success");
        clearButtonBusy(resendBtn);
      } catch {
        if (statusEl) announce(statusEl, "Something went wrong. Please try again.", "danger");
        clearButtonBusy(resendBtn);
      }
    })();
  });
}
