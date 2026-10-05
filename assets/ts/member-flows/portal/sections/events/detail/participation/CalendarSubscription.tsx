import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { useEffect, useState } from "preact/hooks";
import { z } from "zod";
import {
  agendaCalendarSettingsSchema,
  agendaCalendarSubscriptionSchema,
} from "../../../../../../../shared/schemas/event-agenda-calendar";
import { postJson, deleteJson, getJson, putJson } from "../../../../../../shared/api-client";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { TextInput } from "../../../../../../ui/TextControl";
import { Field } from "../../../../../../ui/Field";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { EventPushNotifications } from "../../../../notifications/EventPushNotifications";
export function CalendarSubscription({ slug }: { slug: string }) {
  const [includeTentative, setTentative] = useState(false),
    [reminderEnabled, setEnabled] = useState(false),
    [reminderMinutes, setMinutes] = useState(10);
  const [url, setUrl] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/calendar/subscriptions`;
  const settingsEndpoint = `/api/v1/events/${encodeURIComponent(slug)}/calendar/settings`;
  const form = useContractForm(agendaCalendarSettingsSchema, { includeTentative, reminderEnabled, reminderMinutes });
  useEffect(() => {
    const controller = new AbortController();
    setUrl("");
    setMessage("");
    void getJson(settingsEndpoint, agendaCalendarSettingsSchema, { signal: controller.signal })
      .then((settings) => {
        setTentative(settings.includeTentative);
        setEnabled(settings.reminderEnabled);
        setMinutes(settings.reminderMinutes);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Unable to load calendar preferences.");
      });
    return () => controller.abort();
  }, [settingsEndpoint]);
  async function change(action: "save" | "rotate") {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (action === "rotate") {
        const subscription = await postJson(endpoint, checked.data, agendaCalendarSubscriptionSchema);
        setUrl(subscription.url);
        setMessage("New private calendar URL created. Previous URLs have been revoked.");
      } else {
        await putJson(settingsEndpoint, checked.data, agendaCalendarSettingsSchema);
        setMessage("Calendar and reminder preferences saved.");
      }
    } catch (error) {
      setError(form.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setBusy(true);
    setError("");
    try {
      await deleteJson(endpoint, z.object({ revoked: z.literal(true) }));
      setUrl("");
      setMessage("Private calendar URLs revoked. Remove the old subscription from your calendar app.");
    } catch (error) {
      setError(form.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel aria-label="Private calendar subscription">
      <PanelHeader title="Your calendar" />
      <PanelBody>
        <p>
          Subscribe to your reserved sessions. Calendar apps choose when to refresh; changes can take time to appear.
        </p>
        <form
          noValidate
          {...form.handlers}
          onSubmit={(event) => {
            event.preventDefault();
            void change("save");
          }}
        >
          <Field label="Tentative sessions" {...form.of("includeTentative")}>
            {(control) => (
              <Checkbox
                {...control}
                name="includeTentative"
                label="Include saved preferences, pending approval and waitlisted sessions"
                checked={includeTentative}
                onInput={(event) => setTentative(event.currentTarget.checked)}
              />
            )}
          </Field>
          <Field label="Email reminders" {...form.of("reminderEnabled")}>
            {(control) => (
              <Checkbox
                {...control}
                name="reminderEnabled"
                label="Email me before my reserved sessions"
                checked={reminderEnabled}
                onInput={(event) => setEnabled(event.currentTarget.checked)}
              />
            )}
          </Field>
          {reminderEnabled && (
            <Field label="Minutes before the session" {...form.of("reminderMinutes")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="reminderMinutes"
                  type="number"
                  value={reminderMinutes}
                  onInput={(event) => setMinutes(event.currentTarget.valueAsNumber)}
                />
              )}
            </Field>
          )}
          <Button type="submit" loading={busy}>
            Save preferences
          </Button>
        </form>
        <Button type="button" onClick={() => void change("rotate")} disabled={busy}>
          Create or replace calendar URL
        </Button>
        <Button type="button" onClick={() => void revoke()} disabled={busy}>
          Revoke calendar URLs
        </Button>
        {url && (
          <div>
            <a href={url} rel="noreferrer">
              Open private calendar
            </a>
            <br />
            <Field
              label="Private calendar URL"
              help="Keep this URL private. Copy it into your calendar app’s subscription setting."
            >
              {(control) => (
                <TextInput {...control} value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
              )}
            </Field>
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {error && <ErrorAlert error={error} />}
        <EventPushNotifications key={slug} slug={slug} />
      </PanelBody>
    </Panel>
  );
}
