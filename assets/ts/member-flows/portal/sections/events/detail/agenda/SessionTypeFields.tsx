import { agendaSessionFormatContent } from "../../../../../../../shared/event-agenda-format";
import {
  agendaSessionKindSchema,
  type AgendaOccurrence,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";

const kindLabels: Record<AgendaOccurrence["kind"], string> = {
  session: "Session",
  break: "Break",
  plenary: "Plenary",
};

/** What the agenda item is: its type, its configured session format and its program track, side by side. */
export function SessionTypeFields({
  snapshot,
  occurrence,
  kind,
  onKind,
  format,
  onFormat,
  track,
  onTrack,
  of,
}: {
  snapshot: Pick<AgendaSnapshot, "formats">;
  occurrence?: AgendaOccurrence;
  kind: AgendaOccurrence["kind"];
  /** A lunch or networking choice is a break with a suggested title. */
  onKind: (kind: AgendaOccurrence["kind"], suggestedTitle?: string) => void;
  format: string;
  onFormat: (value: string) => void;
  track: string;
  onTrack: (value: string) => void;
  of: (name: string) => FieldPresentation;
}) {
  const formatOptions = snapshot.formats ?? [];
  // A retired session type remains selectable for the occurrence that already uses it.
  const retiredFormat =
    occurrence?.format && !formatOptions.some((option) => option.id === occurrence.format)
      ? agendaSessionFormatContent(undefined, occurrence.format)
      : undefined;
  const proposalType = occurrence?.sourceProposalType ? `Proposal type: ${occurrence.sourceProposalType}.` : undefined;
  return (
    <div class="pk-agenda-editor__form-row">
      <Field label="Type" help={kind === "break" ? proposalType : undefined} {...of("kind")}>
        {(control) => (
          <Select
            {...control}
            name="kind"
            value={kind}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "lunch" || value === "networking")
                onKind("break", value === "lunch" ? "Lunch" : "Networking");
              else onKind(agendaSessionKindSchema.parse(value));
            }}
          >
            {agendaSessionKindSchema.options.map((value) => (
              <option value={value}>{kindLabels[value]}</option>
            ))}
            <option value="lunch">Lunch (break)</option>
            <option value="networking">Networking (break)</option>
          </Select>
        )}
      </Field>
      {kind !== "break" && (
        <Field label="Format" help={proposalType} {...of("format")}>
          {(control) => (
            <Select {...control} name="format" value={format} onChange={(event) => onFormat(event.currentTarget.value)}>
              <option value="">No format</option>
              {formatOptions.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                </option>
              ))}
              {retiredFormat && <option value={retiredFormat.id}>{retiredFormat.label} (no longer configured)</option>}
            </Select>
          )}
        </Field>
      )}
      <Field label="Track" help="Optional program grouping." {...of("track")}>
        {(control) => (
          <TextInput {...control} name="track" value={track} onInput={(event) => onTrack(event.currentTarget.value)} />
        )}
      </Field>
    </div>
  );
}
