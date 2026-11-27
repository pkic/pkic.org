import { Dialog } from "../../../../../../../ui/Dialog";
import type { useStudioFullscreen } from "./useStudioFullscreen";

/** Confirms leaving full screen after Escape asked to; nothing while it did not. */
export function LeaveFullscreenDialog({ fullscreen }: { fullscreen: ReturnType<typeof useStudioFullscreen> }) {
  if (!fullscreen.confirmingExit) return null;
  return (
    <Dialog
      open
      title="Leave full screen?"
      description="The studio goes back into the portal page. Nothing on air changes."
      confirmLabel="Leave full screen"
      cancelLabel="Stay in full screen"
      onConfirm={fullscreen.confirmExit}
      onCancel={fullscreen.stay}
    />
  );
}
