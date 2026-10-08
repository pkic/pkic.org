import { useState } from "preact/hooks";
import { agendaSponsorChoicesResponseSchema } from "../../../../../../../shared/schemas/event-agenda-sponsors";
import { formatNumber } from "../../../../../../../shared/format-number";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { useApiPage } from "../../../../../../hooks/useApiPage";
import { Pager } from "../../../../../../components/Pager";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";

/** Select existing event sponsorship records; branding is supplied by their canonical public projection. */
export function AgendaSponsorFields({
  slug,
  value,
  onChange,
  disabled = false,
  ...validation
}: FieldPresentation & {
  slug: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const listing = useApiPage(
    `/api/v1/events/${encodeURIComponent(slug)}/agenda/sponsors`,
    { q: query.trim(), sort: "name" },
    agendaSponsorChoicesResponseSchema,
    (data) => data.sponsors,
  );
  const choices = listing.data?.sponsors ?? [];
  return (
    <div class="pk-stack pk-agenda-editor__form-wide">
      <Field label="Find sponsor">
        {(control) => (
          <TextInput
            {...control}
            type="search"
            value={query}
            disabled={disabled}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        )}
      </Field>
      {listing.error && <ErrorAlert error={listing.error.message} />}
      <Field
        label="Sponsors"
        help="Choose existing event sponsors whose logos should appear with this break. Use Ctrl or Command to select several."
        {...validation}
      >
        {(control) => (
          <Select
            {...control}
            name="sponsorIds"
            multiple
            size={Math.min(6, Math.max(2, choices.length))}
            disabled={disabled || listing.loading || Boolean(listing.error)}
            onChange={(event) => {
              const currentPageIds = new Set(choices.map((choice) => choice.sponsorId));
              const selected = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
              onChange([...value.filter((id) => !currentPageIds.has(id)), ...selected]);
            }}
          >
            {choices.map((choice) => (
              <option key={choice.sponsorId} value={choice.sponsorId} selected={value.includes(choice.sponsorId)}>
                {choice.display.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {listing.loading && <p role="status">Loading sponsors…</p>}
      {!listing.loading && !listing.error && !choices.length && <p>No matching event sponsors.</p>}
      <div class="pk-cluster">
        <span>{formatNumber(value.length)} selected</span>
        <Button size="sm" disabled={disabled || !value.length} onClick={() => onChange([])}>
          Clear sponsors
        </Button>
      </div>
      {listing.pagerProps && <Pager {...listing.pagerProps} />}
    </div>
  );
}
