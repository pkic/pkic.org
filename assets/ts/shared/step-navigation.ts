/**
 * Multi-step wizard navigation — shared between registration and proposal flows.
 *
 * Each [data-step="N"] element is a page; only the active step is visible.
 * The stepper indicator ([data-step-item="N"]) reflects progress.
 * Validation runs only on fields within the currently visible step before
 * allowing the user to advance — so the form never becomes a wall of red.
 */
import { clearStatus } from "./form-validation";
import { findFieldErrorTarget } from "./validation-map";

/**
 * Installs step navigation on the given root element.
 *
 * @param root     The `.event-flow` container element.
 * @param form     The `<form>` element inside root.
 * @param statusEl The `[data-flow-status]` element used to show/clear errors.
 * @param onBeforeNext Optional callback called with the current step number
 *                     *before* advancing. Returning false cancels navigation.
 */
export function installStepNavigation(
  root: HTMLElement,
  form: HTMLFormElement,
  statusEl: HTMLElement,
  onBeforeNext?: (currentStep: number) => boolean | void,
): void {
  const stepEls = Array.from(root.querySelectorAll<HTMLElement>("[data-step]")).sort(
    (a, b) => Number(a.dataset.step) - Number(b.dataset.step),
  );
  const stepItems = Array.from(root.querySelectorAll<HTMLElement>("[data-step-item]"));
  const backBtn = root.querySelector<HTMLButtonElement>("[data-step-back]");
  const nextBtn = root.querySelector<HTMLButtonElement>("[data-step-next]");
  const submitBtn = form.querySelector<HTMLButtonElement>("button[type='submit']");
  const fillEl = root.querySelector<HTMLElement>("[data-step-fill]");

  if (stepEls.length < 2) return;

  const total = stepEls.length;
  let current = 1;

  function applyState(): void {
    stepEls.forEach((el, i) => {
      const n = i + 1;
      el.hidden = n !== current;
      el.classList.toggle("is-active", n === current);
    });

    stepItems.forEach((item) => {
      const n = Number(item.dataset.stepItem);
      item.classList.toggle("is-active", n === current);
      item.classList.toggle("is-done", n < current);
      if (n === current) {
        item.setAttribute("aria-current", "step");
      } else {
        item.removeAttribute("aria-current");
      }
    });

    if (fillEl) {
      fillEl.style.width = `${((current - 1) / (total - 1)) * 100}%`;
    }

    if (backBtn) backBtn.hidden = current === 1;
    if (nextBtn) nextBtn.hidden = current === total;
    if (submitBtn) submitBtn.hidden = current !== total;
  }

  function validateCurrentStep(): boolean {
    const stepEl = stepEls[current - 1];
    if (!stepEl) return true;

    // Only validate non-disabled, non-visually-hidden fields in this step.
    const fields = Array.from(
      stepEl.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input:not([type='hidden']), select, textarea",
      ),
    ).filter((f) => !f.disabled && f.closest('[aria-hidden="true"]') === null);

    let firstInvalid: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null = null;
    let hasErrors = false;

    for (const field of fields) {
      if (!field.checkValidity()) {
        hasErrors = true;
        const errorTarget = findFieldErrorTarget(form, field.name);
        if (errorTarget) {
          errorTarget.textContent = field.validationMessage || "Required";
        }
        if (!firstInvalid) firstInvalid = field;
      } else {
        const errorTarget = findFieldErrorTarget(form, field.name);
        if (errorTarget) errorTarget.textContent = "";
      }
    }

    if (hasErrors) {
      form.classList.add("was-validated");
      firstInvalid?.focus();
    }

    return !hasErrors;
  }

  function goNext(): void {
    if (onBeforeNext) {
      const result = onBeforeNext(current);
      if (result === false) return;
    }
    if (!validateCurrentStep()) return;
    clearStatus(statusEl);
    if (current < total) {
      current++;
      applyState();
      root.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function goBack(): void {
    if (current > 1) {
      clearStatus(statusEl);
      current--;
      applyState();
      root.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  nextBtn?.addEventListener("click", goNext);
  backBtn?.addEventListener("click", goBack);

  // Allow pressing Enter in step 1 inputs to advance (feels natural).
  stepEls[0]?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      goNext();
    }
  });

  applyState();
}
