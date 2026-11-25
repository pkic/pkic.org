import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../../../../../../ui/Button";
import { SponsorLeadNoteDialog } from "../agenda/SponsorLeadNoteDialog";
import type { LeadConfirmation } from "./ScannerLeadConfirmation";
import "./ScannerLeadConfirmation.css";

/**
 * Adds the sponsor team's note to the lead just captured. Capture pauses while the note is open, so the next badge
 * cannot replace the person being written about; the note stays bound to this lead either way.
 */
export function ScannerLeadNote({
  slug,
  sponsorId,
  confirmation,
  onPause,
  onSaved,
}: {
  slug: string;
  sponsorId: string;
  confirmation: LeadConfirmation;
  onPause: (paused: boolean) => void;
  onSaved: (leadId: string, note: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const pause = useRef(onPause);
  pause.current = onPause;
  const openRef = useRef(false);
  openRef.current = open;
  // Capture never stays paused behind a note that is no longer on screen.
  useEffect(
    () => () => {
      if (openRef.current) pause.current(false);
    },
    [],
  );
  function close() {
    setOpen(false);
    onPause(false);
  }
  return (
    <div class="pk-scanner-lead-note">
      <Button
        onClick={() => {
          onPause(true);
          setOpen(true);
        }}
      >
        {confirmation.note ? "Edit note" : "Add note"}
      </Button>
      {open && (
        // Escape closes only the note: the scanner around it exits on Escape too. The dialog still sees the key.
        <div
          class="pk-scanner-lead-note-dialog"
          onKeyDown={(event) => {
            if (event.key === "Escape") event.stopPropagation();
          }}
        >
          <SponsorLeadNoteDialog
            slug={slug}
            sponsorId={sponsorId}
            leadId={confirmation.leadId}
            name={confirmation.name}
            note={confirmation.note}
            onClose={close}
            onSaved={(note) => {
              onSaved(confirmation.leadId, note);
              close();
            }}
          />
        </div>
      )}
    </div>
  );
}
