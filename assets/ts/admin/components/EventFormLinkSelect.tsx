import { eventFormCatalog } from "../services/catalogs";
import { ServerSearchSelect } from "./ServerSearchSelect";

export function EventFormLinkSelect({
  eventSlug,
  purpose,
  label,
  value,
  disabled,
  help,
  autoSelectFirst,
  onChange,
}: {
  eventSlug: string;
  purpose: "event_registration" | "proposal_submission";
  label: string;
  value: string;
  disabled: boolean;
  help: string;
  autoSelectFirst?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div class="col-md-6">
      <ServerSearchSelect
        catalog={eventFormCatalog(eventSlug, purpose, "active")}
        label={label}
        value={value}
        selectedLabel={value ? `${value} (linked)` : undefined}
        placeholder="No form"
        disabled={disabled}
        autoSelectFirst={autoSelectFirst}
        onChange={(form) => onChange(form?.key ?? "")}
      />
      <div class="form-text">{help}</div>
    </div>
  );
}
