import { IconPeople } from "../ui/MediaIcons";
import "./SessionAdmissionNote.css";

/**
 * How a session admits people, as one fine line among the session details' header metadata.
 * The wording comes from `sessionAdmissionNote` in the shared participation vocabulary.
 */
export function SessionAdmissionNote({ note }: { note: string }) {
  return (
    <p class="pk-session-admission">
      <IconPeople />
      <span>{note}</span>
    </p>
  );
}
