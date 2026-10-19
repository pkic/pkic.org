import { useEffect, useState } from "preact/hooks";
import {
  agendaCalendarCurrentSubscriptionSchema,
  agendaCalendarRevokeResponseSchema,
  agendaCalendarSettingsSchema,
  agendaCalendarSubscriptionSchema,
  type AgendaCalendarCurrentSubscription,
  type AgendaCalendarSettings,
} from "../../../../../../../shared/schemas/event-agenda-calendar";
import { deleteJson, getJson, postJson, putJson } from "../../../../../../shared/api-client";

/** The viewer's calendar link and reminder preferences for one event, read together and kept in step. */
export function useAgendaCalendar(slug: string) {
  const base = `/api/v1/events/${encodeURIComponent(slug)}/calendar`;
  const [settings, setSettings] = useState<AgendaCalendarSettings | null>(null);
  const [link, setLink] = useState<AgendaCalendarCurrentSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSettings(null);
    setLink(null);
    setError(null);
    void Promise.all([
      getJson(`${base}/settings`, agendaCalendarSettingsSchema, { signal: controller.signal }),
      getJson(`${base}/subscriptions/current`, agendaCalendarCurrentSubscriptionSchema, {
        signal: controller.signal,
      }),
    ])
      .then(([loadedSettings, loadedLink]) => {
        if (controller.signal.aborted) return;
        setSettings(loadedSettings);
        setLink(loadedLink);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Your calendar settings could not be loaded.");
      });
    return () => controller.abort();
  }, [base, attempt]);

  /** Issues a new link; any earlier link stops working. */
  async function createLink(current: AgendaCalendarSettings) {
    const subscription = await postJson(`${base}/subscriptions`, current, agendaCalendarSubscriptionSchema);
    setLink({ active: true, subscription });
    return subscription.url;
  }
  async function turnOffLink() {
    await deleteJson(`${base}/subscriptions`, agendaCalendarRevokeResponseSchema);
    setLink({ active: false, subscription: null });
  }
  async function saveSettings(next: AgendaCalendarSettings) {
    const saved = await putJson(`${base}/settings`, next, agendaCalendarSettingsSchema);
    setSettings(saved);
    return saved;
  }
  return {
    settings,
    link,
    error,
    reload: () => setAttempt((value) => value + 1),
    createLink,
    turnOffLink,
    saveSettings,
  };
}
export type AgendaCalendar = ReturnType<typeof useAgendaCalendar>;
