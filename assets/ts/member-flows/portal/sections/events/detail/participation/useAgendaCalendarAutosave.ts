import { useEffect, useState } from "preact/hooks";
import {
  agendaCalendarSettingsSchema,
  type AgendaCalendarSettings,
} from "../../../../../../../shared/schemas/event-agenda-calendar";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { toast } from "../../../../ui";

/**
 * Calendar and reminder switches take effect as they move, as a switch does. Each change is checked
 * against the settings contract the route parses and saved; a refusal puts the saved values back.
 */
export function useAgendaCalendarAutosave(
  saved: AgendaCalendarSettings,
  save: (next: AgendaCalendarSettings) => Promise<unknown>,
) {
  const [draft, setDraft] = useState<AgendaCalendarSettings | null>(null);
  const settings = draft ?? saved;
  const form = useContractForm(agendaCalendarSettingsSchema, settings);
  const [request, setRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (request === 0) return;
    const checked = form.submit();
    if (!checked.data) {
      toast(checked.message, "error");
      return;
    }
    setSaving(true);
    save(checked.data)
      .then(() => toast("Saved.", "success"))
      .catch((error: unknown) => toast(form.refuse(error), "error"))
      .finally(() => {
        setDraft(null);
        setSaving(false);
      });
  }, [request]);
  return {
    settings,
    form,
    saving,
    change: (patch: Partial<AgendaCalendarSettings>) => {
      setDraft({ ...settings, ...patch });
      setRequest((value) => value + 1);
    },
  };
}
export type AgendaCalendarAutosave = ReturnType<typeof useAgendaCalendarAutosave>;
