import { useMemo } from "preact/hooks";
import { eventRecordingVersionsResponseSchema } from "../../../../../../../shared/schemas/event-recordings";
import type { EventRecordingVersion } from "../../../../../../../shared/schemas/event-recordings";
import { formatNumber } from "../../../../../../../shared/format-number";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { Field } from "../../../../../../ui/Field";

export function SessionRecordingVersionField({
  slug,
  value,
  version,
  onChange,
}: {
  slug: string;
  value: string | null;
  version: number;
  onChange: (item: EventRecordingVersion | null) => void;
}) {
  const catalog = useMemo(
    () => ({
      endpoint: `/api/v1/events/${encodeURIComponent(slug)}/recordings/versions`,
      responseSchema: eventRecordingVersionsResponseSchema,
      resolveItems: (response: { versions: EventRecordingVersion[] }) => response.versions,
      resolvePage: (response: ReturnType<typeof eventRecordingVersionsResponseSchema.parse>) => response.page,
      itemKey: (item: EventRecordingVersion) => item.id,
      itemLabel: (item: EventRecordingVersion) =>
        `Version ${formatNumber(item.version)} · ${item.mimeType} · ${item.digest.slice(0, 12)}`,
      sort: "-acquiredAt",
    }),
    [slug],
  );
  return (
    <Field
      label="Owned recording version"
      help="Select acquired bytes explicitly. Rights, consent and release approval remain separate."
    >
      {(control) => (
        <ServerSearchSelect
          {...control}
          catalog={catalog}
          searchLabel="Recording version"
          value={value}
          selectedLabel={value ? `Saved recording · version ${formatNumber(version)}` : undefined}
          placeholder="Use a recording link instead"
          autoSelectFirst={false}
          onChange={onChange}
        />
      )}
    </Field>
  );
}
