import type { ComponentChildren, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button } from "./Button";
import { CloseButton } from "./CloseButton";
import { SectionHeading } from "./SectionHeading";
import { HeadingOutline } from "./HeadingOutline";
import { usePopupPlacement } from "./popup-placement";
import { formatNumber } from "../../shared/format-number";
import "../../design/tokens.tour.generated.css";
import "./GuidedTour.css";

export interface GuidedTourStep {
  id: string;
  target: string;
  title: string;
  body: string;
  actions?: ComponentChildren;
}

/** An explicit, replayable tour: local UI state only, with scoped targets. */
export function GuidedTour({
  steps,
  scope,
  onClose,
  onStepChange,
}: {
  steps: readonly GuidedTourStep[];
  scope: RefObject<HTMLElement>;
  onClose: () => void;
  onStepChange?: (id: string | null) => void;
}) {
  const [availableIds, setAvailableIds] = useState<string[]>([]);
  const latestSteps = useRef(steps);
  latestSteps.current = steps;
  const stepListKey = steps.map((step) => `${step.id}:${step.target}`).join("|");
  const available = steps.filter((step) => availableIds.includes(step.id));
  const [index, setIndex] = useState(0);
  const currentIndex = Math.min(index, Math.max(0, available.length - 1));
  const step = available[currentIndex];
  const targetSelector = step?.target;
  const stepId = step?.id;
  const popup = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement);
  const callbacks = useRef({ onClose, onStepChange });
  callbacks.current = { onClose, onStepChange };
  const id = useId();
  useEffect(() => {
    // A tour can start with a newly mounted screen, after its scope ref is attached.
    const ids = latestSteps.current.filter((step) => scope.current?.querySelector(step.target)).map((step) => step.id);
    setAvailableIds(ids);
    if (!ids.length) callbacks.current.onClose();
  }, [scope, stepListKey]);
  useLayoutEffect(() => {
    const target = targetSelector ? scope.current?.querySelector<HTMLElement>(targetSelector) : null;
    anchor.current = target ?? null;
    target?.setAttribute("data-tour-active", "");
    heading.current?.focus({ preventScroll: true });
    return () => target?.removeAttribute("data-tour-active");
  }, [scope, targetSelector, stepId]);
  const point = useCallback(() => {
    const target = anchor.current?.getBoundingClientRect();
    const card = popup.current;
    if (!target || !card) return;
    const box = card.getBoundingClientRect();
    card.dataset.pointer = box.y + box.height / 2 < target.y + target.height / 2 ? "bottom" : "top";
    const inset = Number.parseFloat(getComputedStyle(card).paddingLeft) || 0;
    card.style.setProperty(
      "--pk-tour-pointer-x",
      `${Math.max(inset, Math.min(box.width - inset, target.x + target.width / 2 - box.x))}px`,
    );
  }, []);
  usePopupPlacement({
    open: Boolean(step),
    anchorRef: anchor,
    popupRef: popup,
    side: "top",
    revision: step?.id,
    topLayer: true,
    matchAnchorWidth: false,
    afterPlace: point,
  });
  useEffect(() => {
    const initialOpener = opener.current;
    const initialScope = scope.current;
    const onFinished = callbacks.current.onStepChange;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        callbacks.current.onClose();
      }
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      const launcher = target instanceof Element ? target.closest("[data-tour-trigger]") : null;
      if (!popup.current?.contains(target as Node) && !(launcher && scope.current?.contains(launcher)))
        callbacks.current.onClose();
    };
    document.addEventListener("keydown", dismiss, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", dismiss, true);
      document.removeEventListener("pointerdown", outside);
      onFinished?.(null);
      const restore =
        initialOpener instanceof HTMLElement && initialOpener !== document.body && initialOpener.isConnected
          ? initialOpener
          : initialScope?.querySelector<HTMLElement>("[data-tour-trigger]");
      restore?.focus({ preventScroll: true });
    };
  }, [scope]);
  if (!step) return null;
  const move = (next: number) => {
    callbacks.current.onStepChange?.(available[next]!.id);
    setIndex(next);
  };
  return createPortal(
    <div
      ref={popup}
      class="pk-guided-tour"
      role="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (
          next instanceof Node &&
          !event.currentTarget.contains(next) &&
          !(next instanceof Element && next.closest("[data-tour-trigger]"))
        )
          onClose();
      }}
    >
      <div class="pk-guided-tour__panel">
        <HeadingOutline titleLevel={2}>
          <progress
            class="pk-guided-tour__progress"
            max={available.length}
            value={currentIndex + 1}
            aria-label="Tour progress"
          />
          <header>
            <div ref={heading} tabIndex={-1}>
              <SectionHeading id={`${id}-title`} level={2}>
                {step.title}
              </SectionHeading>
            </div>
            <CloseButton label="Close help tour" onClick={onClose} />
          </header>
          <p id={`${id}-body`}>{step.body}</p>
          {step.actions}
          <footer>
            <span>
              {formatNumber(currentIndex + 1)} of {formatNumber(available.length)}
            </span>
            {currentIndex > 0 && (
              <Button variant="ghost" onClick={() => move(currentIndex - 1)}>
                Back
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => (currentIndex + 1 < available.length ? move(currentIndex + 1) : onClose())}
            >
              {currentIndex + 1 < available.length ? "Next" : "Done"}
            </Button>
          </footer>
        </HeadingOutline>
      </div>
    </div>,
    scope.current ?? document.body,
  );
}
