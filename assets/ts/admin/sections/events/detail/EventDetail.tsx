import { useState, useEffect, useCallback } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { toast } from "../../../ui";
import type { EventDetail } from "../../../types";
import { Settings } from "./Settings";
import { Registrations } from "./Registrations";
import { Proposals } from "./Proposals";
import { Promoters } from "./Promoters";
import { EventStats } from "./EventStats";
import { currentEvent } from "../../../state";

type EventDetailTab =
  | "registrations"
  | "proposals"
  | "promoters"
  | "stats"
  | "settings";

const TABS: Array<{ key: EventDetailTab; label: string }> = [
  { key: "registrations", label: "Registrations" },
  { key: "proposals",     label: "Proposals" },
  { key: "promoters",     label: "Promoters" },
  { key: "stats",         label: "Stats" },
  { key: "settings",      label: "Settings" },
];

export function EventDetailView({ slug, tab: tabProp, subTab }: { slug: string; tab?: string; subTab?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [, navigate] = useHashLocation();
  const tab: EventDetailTab = (TABS.find((t) => t.key === tabProp)?.key ?? "registrations") as EventDetailTab;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ event: EventDetail }>(`/api/v1/admin/events/${slug}`);
      setEvent(data.event);
      currentEvent.value = data.event;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  function handleUpdated(updated: EventDetail) {
    setEvent(updated);
    currentEvent.value = updated;
    toast("Event updated", "success");
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!event) return null;

  return (
    <div>
      {/* Header */}
      <div class="d-flex align-items-start gap-2 mb-3 flex-wrap">
        <div>
          <h5 class="mb-1">{event.name}</h5>
          <div class="text-muted small">
            <span class="mono">{event.slug}</span>
            {event.starts_at && <> · {event.starts_at.substring(0, 10)}</>}
            {event.venue && <> · {event.venue}</>}
          </div>
        </div>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void load()}>↺ Refresh</button>
      </div>

      {/* Tabs */}
      <Tabs items={TABS} active={tab} onChange={(key) => navigate(`/events/${slug}/${key}`)} className="mb-3 flex-wrap" />

      {/* Tab content */}
      {tab === "registrations" && <Registrations slug={slug} subTab={subTab} />}
      {tab === "proposals"     && <Proposals slug={slug} subTab={subTab} />}
      {tab === "promoters"     && <Promoters slug={slug} subTab={subTab} />}
      {tab === "stats"         && <EventStats slug={slug} />}
      {tab === "settings"      && <Settings event={event} onUpdated={handleUpdated} subTab={subTab} />}
    </div>
  );
}
