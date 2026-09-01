import { useId } from "preact/hooks";
import { eventFormCatalog } from "../../../../../../shared/management-catalogs";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";

/**
 * One form picker on the event's General tab.
 *
 * The width used to come from `col-md-6` here while the parent also laid the
 * pickers out, so the column was sized twice. The parent's stack owns the
 * layout now and this owns only the picker and the sentence explaining it.
 *
 * `ServerSearchSelect` labels its own control, so the help cannot be handed to
 * it as a `Field`'s `help`. The pair is a named group described by the
 * sentence instead, which keeps the association programmatic rather than
 * leaving the text floating below an unrelated control.
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
  const helpId = `${useId()}-help`;

  return (
    <div class="pk pk-stack pk-stack--tight" role="group" aria-label={label} aria-describedby={helpId}>
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
      <p class="pk-small" id={helpId}>
        {help}
      </p>
    </div>
  );
}
