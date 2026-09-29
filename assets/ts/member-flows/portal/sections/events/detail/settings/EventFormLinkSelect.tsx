import { eventFormCatalog } from "../../../../../../shared/management-catalogs";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { Field } from "../../../../../../ui/Field";

/**
 * One form picker on the event's General tab.
 *
 * The width used to come from `col-md-6` here while the parent also laid the
 * pickers out, so the column was sized twice. The parent's stack owns the
 * layout now and this owns only the picker and the sentence explaining it —
 * a design-system `Field`, whose help the control describes itself by.
 */
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
    <div class="pk">
      <Field label={label} help={help}>
        {(control) => (
          <ServerSearchSelect
            {...control}
            catalog={eventFormCatalog(eventSlug, purpose, "active")}
            searchLabel={label}
            value={value}
            selectedLabel={value ? `${value} (linked)` : undefined}
            placeholder="No form"
            disabled={disabled}
            autoSelectFirst={autoSelectFirst}
            onChange={(form) => onChange(form?.key ?? "")}
          />
        )}
      </Field>
    </div>
  );
}
