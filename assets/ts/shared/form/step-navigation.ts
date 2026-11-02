/**
 * Multi-step wizard navigation — shared between registration and proposal flows.
 *
 * Each [data-step="N"] element is a page; only the active step is visible.
 * The stepper indicator ([data-step-item="N"]) reflects progress.
 * Validation runs only on fields within the currently visible step before
 * allowing the user to advance — so the form never becomes a wall of red.
 */
import { clearStatus, isNativelyValidated } from "./validation";
import { findFieldErrorTarget } from "./validation-map";
import { splitHash, subscribeUrlQuery, writeUrlQuery } from "../../ui/url-query";

export const REGISTRATION_STEP_PARAM = "registrationStep";
type StepHistory = { source: "hash" | "search"; ownerPath: string; param: string };

/**
 * Installs step navigation on the given root element.
 *
 * @param root     The `.event-flow` container element.
 * @param form     The `<form>` element inside root.
 * @param statusEl The `[data-flow-status]` element used to show/clear errors.
 * @param onBeforeNext Optional callback called with the current step number
 *                     *before* advancing. Returning false cancels navigation.
 * @returns `continueFrom(step)`: continues past `step` exactly as the Continue
 *          button would, when the person is still on it — for a step the flow
 *          learns is already complete, such as terms a confirmed email recorded.
 */
export function installStepNavigation(
  root: HTMLElement,
  form: HTMLFormElement,
  statusEl: HTMLElement,
  onBeforeNext?: (currentStep: number) => boolean | void,
  onStepChange?: (currentStep: number) => void,
  stepHistory?: StepHistory,
): { continueFrom: (step: number) => void; dispose: () => void } {
  const events = new window.AbortController();
  const listenerOptions = { signal: events.signal };
  const stepEls = Array.from(root.querySelectorAll<HTMLElement>("[data-step]")).sort(
    (a, b) => Number(a.dataset.step) - Number(b.dataset.step),
  );
  const stepItems = Array.from(root.querySelectorAll<HTMLElement>("[data-step-item]"));
  const backBtn = root.querySelector<HTMLButtonElement>("[data-step-back]");
  const nextBtn = root.querySelector<HTMLButtonElement>("[data-step-next]");
  const submitBtn = form.querySelector<HTMLButtonElement>("button[type='submit']");

  if (stepEls.length < 2) return { continueFrom: () => {}, dispose: () => {} };

  const total = stepEls.length;
  let current = 1;
  let completed = 1;
  function readHistory() {
    return stepHistory?.source === "hash"
      ? splitHash()
      : { path: location.pathname, params: new URLSearchParams(location.search) };
  }
  function writeStep(step: number, mode: "push" | "replace") {
    if (!stepHistory) return;
    const { params } = readHistory();
    params.set(stepHistory.param, String(step));
    writeUrlQuery({ ...stepHistory, params, mode });
  }
  const unsubscribe = stepHistory
    ? subscribeUrlQuery(() => {
        const { path, params } = readHistory();
        if (path !== stepHistory.ownerPath) return;
        const raw = params.get(stepHistory.param);
        const step = raw === null ? 1 : Number(raw);
        if (!Number.isInteger(step) || step < 1 || step > completed) return;
        if (step === current) return;
        current = step;
        clearStatus(statusEl);
        applyState();
      })
    : () => {};

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
      item.classList.toggle("is-clickable", n < current);
      if (n === current) {
        item.setAttribute("aria-current", "step");
      } else {
        item.removeAttribute("aria-current");
      }
      if (n < current) {
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.setAttribute("aria-label", `Return to step ${n}`);
      } else {
        item.removeAttribute("role");
        item.removeAttribute("tabindex");
        item.removeAttribute("aria-label");
      }
    });

    if (backBtn) backBtn.hidden = current === 1;
    if (nextBtn) nextBtn.hidden = current === total;
    if (submitBtn) submitBtn.hidden = current !== total;
    onStepChange?.(current);
  }

  function validateCurrentStep(): boolean {
    const stepEl = stepEls[current - 1];
    if (!stepEl) return true;

    // Only validate non-disabled, non-visually-hidden fields in this step.
    const fields = Array.from(
      stepEl.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input:not([type='hidden']), select, textarea",
      ),
    ).filter((f) => !f.disabled && isNativelyValidated(f) && f.closest('[aria-hidden="true"]') === null);

    let firstInvalid: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null = null;
    let hasErrors = false;

    for (const field of fields) {
      const errorTarget =
        field.name === "consents" && field.closest("[data-term-key]") ? null : findFieldErrorTarget(form, field.name);
      if (!field.checkValidity()) {
        hasErrors = true;
        if (errorTarget) {
          errorTarget.textContent = field.validationMessage || "Required";
        }
        if (!firstInvalid) firstInvalid = field;
      } else {
        if (errorTarget) errorTarget.textContent = "";
      }
    }

    if (hasErrors) {
      form.classList.add("was-validated");
      firstInvalid?.focus();
    }

    // Consent cards need no separate pass. They are ordinary checkboxes in
    // this step, so the `checkValidity()` above already fired the platform's
    // `invalid` event at each one that has not been agreed to, and each card
    // shows its own message from that. This used to add and remove Bootstrap's
    // `is-invalid` on the card element instead — a second copy of the state,
    // drawn only by the legacy stylesheet.
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
      completed = Math.max(completed, current);
      applyState();
      writeStep(current, "push");
      root.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function goBack(): void {
    if (current > 1) {
      if (stepHistory) {
        window.history.back();
        return;
      }
      clearStatus(statusEl);
      current--;
      applyState();
      root.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function goToCompletedStep(step: number): void {
    if (step >= current || step < 1 || step > total) return;
    if (stepHistory) {
      window.history.go(step - current);
      return;
    }
    clearStatus(statusEl);
    current = step;
    applyState();
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  nextBtn?.addEventListener("click", goNext, listenerOptions);
  backBtn?.addEventListener("click", goBack, listenerOptions);
  root.addEventListener(
    "click",
    (event) => {
      const trigger =
        event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-step-jump]") : null;
      if (!trigger) return;
      goToCompletedStep(Number(trigger.dataset.stepJump));
    },
    listenerOptions,
  );
  stepItems.forEach((item) => {
    item.addEventListener(
      "click",
      () => {
        goToCompletedStep(Number(item.dataset.stepItem));
      },
      listenerOptions,
    );
    item.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        goToCompletedStep(Number(item.dataset.stepItem));
      },
      listenerOptions,
    );
  });

  // Allow pressing Enter in step 1 inputs to advance (feels natural).
  stepEls[0]?.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        goNext();
      }
    },
    listenerOptions,
  );

  applyState();
  // A fresh form cannot jump past verification via a copied or reloaded URL.
  if (stepHistory && readHistory().params.has(stepHistory.param)) writeStep(1, "replace");
  return {
    dispose: () => {
      events.abort();
      unsubscribe();
    },
    continueFrom: (step) => {
      if (step === current) goNext();
    },
  };
}
