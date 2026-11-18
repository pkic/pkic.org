import type { RefObject } from "preact";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { liveOverlayLayoutChoices } from "../../../../../../../../shared/live-overlay-layout-presets";
import { Button } from "../../../../../../../ui/Button";
import { SectionHeading } from "../../../../../../../ui/SectionHeading";
import { usePopupPlacement } from "../../../../../../../ui/popup-placement";
import { usePressOutside } from "../../../../../../../ui/use-press-outside";
import { previewSceneOf, SceneChoices, type SceneSources } from "./SceneChoices";
import "./ScenePicker.css";

/**
 * The scenes as thumbnails, three to a row, hanging from Preview's scene
 * button. Choosing one loads it into Preview and closes; Escape, a press
 * outside or moving focus away closes it too.
 */
function ScenePopover({
  sources,
  anchorRef,
  onScene,
  onClose,
}: {
  sources: SceneSources;
  anchorRef: RefObject<HTMLElement>;
  onScene: (scene: string) => void;
  onClose: (returnFocus: boolean) => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const heading = useId();
  usePopupPlacement({
    open: true,
    anchorRef,
    popupRef: popup,
    topLayer: true,
    align: "start",
    matchAnchorWidth: false,
  });
  useLayoutEffect(() => {
    popup.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={popup}
      role="dialog"
      aria-modal="false"
      aria-labelledby={heading}
      class="pk pk-studio-scene-popover"
      data-density="compact"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next) && !anchorRef.current?.contains(next))
          onClose(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
      }}
    >
      <SectionHeading level={3} id={heading} class="pk-studio-scene-popover__title">
        Load a scene into Preview
      </SectionHeading>
      <div class="pk-studio-scene-popover__scenes">
        <SceneChoices
          sources={sources}
          disabled={false}
          onScene={(scene) => {
            onScene(scene);
            onClose(true);
          }}
        />
      </div>
    </div>
  );
}

/** Preview's scene by name beside PVW; it opens the scenes as thumbnails to load another into Preview. */
function PreviewScenePicker({
  sources,
  disabled,
  onScene,
}: {
  sources: SceneSources;
  disabled: boolean;
  onScene: (scene: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const { current } = previewSceneOf(sources.preview);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) root.current?.querySelector("button")?.focus({ preventScroll: true });
  }, []);
  const closeOutside = useCallback(() => close(false), [close]);
  usePressOutside(open, root, closeOutside);
  return (
    <span class="pk-studio-scene-picker" ref={root}>
      <Button
        class="pk-studio-scene-picker__trigger"
        aria-label={`Scene in Preview: ${current.name}`}
        title={`Scene in Preview: ${current.name}\nChoose another to load it into Preview. Transition puts it on Program.`}
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        disabled={disabled}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <span class="pk-studio-scene-picker__name">{current.name}</span>
        <span aria-hidden="true">▾</span>
      </Button>
      {open && !disabled ? <ScenePopover sources={sources} anchorRef={root} onScene={onScene} onClose={close} /> : null}
    </span>
  );
}

/**
 * The scene in a monitor's header: Preview's opens the scenes to load
 * another, and the next Take puts it on Program with Preview's graphics.
 * Program names the scene it has on air.
 */
export function ScenePicker({
  output,
  sources,
  disabled,
  onScene,
}: {
  output: "preview" | "program";
  sources: SceneSources;
  disabled: boolean;
  onScene: (scene: string) => void;
}) {
  if (output === "preview") return <PreviewScenePicker sources={sources} disabled={disabled} onScene={onScene} />;
  if (!sources.program) return null;
  const choices = liveOverlayLayoutChoices(sources.preview.overlayLayouts);
  const name = (choices.find((choice) => choice.slug === sources.program!.stage.scene) ?? choices[0]!).name;
  return (
    <span
      class="pk-studio-monitor__purpose"
      title={`Scene on Program: ${name}\nLoad another into Preview and transition to change it.`}
    >
      {name}
    </span>
  );
}
