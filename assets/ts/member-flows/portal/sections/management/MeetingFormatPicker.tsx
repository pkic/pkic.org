import { useState } from "preact/hooks";
import { z } from "zod";
import { meetingFormatCatalogSchema, meetingAgendaItemsSchema } from "../../../../../shared/schemas/meeting-agenda";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { Button } from "../../../../ui/Button";
import { ErrorAlert } from "../../../../components/ErrorAlert";
export function MeetingFormatPicker({
  groupId,
  onCopy,
}: {
  groupId: string;
  onCopy: (name: string, items: z.infer<typeof meetingAgendaItemsSchema>) => void;
}) {
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0);
  const catalog = useData(
    () =>
      getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/formats?limit=20&offset=${offset}&q=${encodeURIComponent(query)}`,
        meetingFormatCatalogSchema,
      ),
    [groupId, query, offset],
  );
  return (
    <section aria-label="Reusable meeting formats">
      <p>
        Copy an accessible format version into this draft. Dates and publication stay with this meeting; speaker
        assignments are cleared for review.
      </p>
      <Field label="Find reusable format">
        {(control) => (
          <TextInput
            {...control}
            value={query}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setOffset(0);
            }}
          />
        )}
      </Field>
      {catalog.error && <ErrorAlert error={catalog.error} />}
      <ul>
        {catalog.data?.formats.map((format) => (
          <li key={`${format.seriesId}/${format.version}`}>
            <strong>{format.name}</strong> · {format.eventName} · version {format.version} ·{" "}
            {format.items.reduce((sum, item) => sum + item.durationMinutes, 0)} minutes{" "}
            <Button
              onClick={() =>
                onCopy(
                  format.name,
                  format.items.map((item) => ({ ...item, id: crypto.randomUUID(), speakerUserIds: [] })),
                )
              }
            >
              Copy this format
            </Button>
          </li>
        ))}
      </ul>
      {catalog.data?.formats.length === 0 && <p>No matching accessible formats.</p>}
      <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>
        Previous formats
      </Button>
      <Button disabled={!catalog.data?.page.hasMore} onClick={() => setOffset(offset + 20)}>
        Next formats
      </Button>
    </section>
  );
}
