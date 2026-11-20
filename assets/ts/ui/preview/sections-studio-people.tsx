/**
 * The people of a session in the studio: the speakers as lower thirds, one
 * row each, anyone operators added for the session, and the dialogs that
 * add a person and edit someone added without an account.
 */
import type { PreviewSection } from "./PreviewShell";
import {
  LiveAddPersonDialog,
  LiveEditPersonDialog,
} from "../../member-flows/portal/sections/events/detail/live/LiveAddPersonDialog";
import { LiveSpeakerCards } from "../../member-flows/portal/sections/events/detail/live/LiveSpeakerCards";
import { DialogSpecimen } from "./sections-event-screens-staff";
import { ROOM } from "./studio-on-screen-fixtures";

/** Someone added without an account: the name and second line are what an operator typed. */
const TYPED_GUEST = {
  ...ROOM.session.credits[0]!,
  key: "added:guest",
  name: "Chris Bailey",
  identity: null,
  additionalIdentities: [],
  titleLine: "Author, Example Press",
};

export const studioPeopleSections: PreviewSection[] = [
  {
    id: "studio-speakers-identities",
    title: "Speakers in the studio, one with two identities",
    note: "The row stays still: it shows the first identity and counts the rest.",
    render: () => (
      <LiveSpeakerCards targets={{ state: ROOM, programActive: true, disabled: false, sendProgram: () => true }} />
    ),
  },
  {
    id: "studio-speakers-added",
    title: "Speakers in a studio panel, one added for this session",
    note: "One row per person like every studio list: PVW, PGM and the menu at the end, which holds the screens and Remove for someone added. Someone without an account shows the second line typed for them, and has Edit person too.",
    render: () => (
      <div class="pk-preview__studio-panel">
        <LiveSpeakerCards
          targets={{
            state: {
              ...ROOM,
              addedCredits: [TYPED_GUEST],
            },
            programActive: true,
            disabled: false,
            sendProgram: () => true,
          }}
        />
      </div>
    ),
  },
  {
    id: "studio-person-add",
    title: "Add a person to a session's lower thirds",
    note: "Someone at the event by search, or someone without an account by their name and an optional second line.",
    render: () => (
      <DialogSpecimen
        label="Add person"
        dialog={(close) => (
          <LiveAddPersonDialog slug="pqc-conference-2026" listed={new Set()} onAdd={() => true} onClose={close} />
        )}
      />
    ),
  },
  {
    id: "studio-person-edit",
    title: "Edit a person added without an account",
    note: "From Edit person in their row menu: the name and second line as typed. A person from an identity has no Edit.",
    render: () => (
      <DialogSpecimen
        label="Edit person"
        dialog={(close) => <LiveEditPersonDialog credit={TYPED_GUEST} onSave={() => true} onClose={close} />}
      />
    ),
  },
];
