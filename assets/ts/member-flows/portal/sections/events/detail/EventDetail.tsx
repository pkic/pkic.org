import { useState, useEffect, useCallback } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { useHashLocation } from "wouter/use-hash-location";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Tabs } from "../../../../../components/Tabs";
import { getJson } from "../../../../../shared/api-client";
import { eventManagementDetailResponseSchema } from "../../../../../../shared/schemas/event-management";
import { toast } from "../../../ui";
import type { EventDetail } from "../types";
import { currentEvent } from "../state";

const Settings = lazy(() => import("./Settings").then((module) => ({ default: module.Settings })));
const Registrations = lazy(() => import("./Registrations").then((module) => ({ default: module.Registrations })));
const Proposals = lazy(() => import("./Proposals").then((module) => ({ default: module.Proposals })));
const Promoters = lazy(() => import("./Promoters").then((module) => ({ default: module.Promoters })));
const EventStats = lazy(() => import("./EventStats").then((module) => ({ default: module.EventStats })));

type EventDetailTab = "registrations" | "proposals" | "promoters" | "stats" | "settings";

const TABS: Array<{ key: EventDetailTab; label: string; capability?: "read" | "write" | "manage" }> = [
  { key: "registrations", label: "Registrations", capability: "manage" },
  { key: "proposals", label: "Proposals", capability: "read" },
  { key: "promoters", label: "Promoters", capability: "read" },
  { key: "stats", label: "Analytics", capability: "read" },
  { key: "settings", label: "Settings", capability: "write" },
];

export function eventDetailTabsForCapabilities(capabilities: EventDetail["capabilities"]) {
  return TABS.filter(({ capability }) => !capability || capabilities.includes(capability));
}

export function EventDetailView({ slug, tab: tabProp, subTab }: { slug: string; tab?: string; subTab?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [, navigate] = useHashLocation();
  const requestedTab = TABS.find((candidate) => candidate.key === tabProp)?.key;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson(`/api/v1/events/${encodeURIComponent(slug)}`, eventManagementDetailResponseSchema);
      setEvent(data.event);
      currentEvent.value = data.event;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleUpdated(updated: EventDetail) {
    setEvent(updated);
    currentEvent.value = updated;
    toast("Event updated", "success");
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!event) return null;
  const visibleTabs = eventDetailTabsForCapabilities(event.capabilities);
  const tab = visibleTabs.find(({ key }) => key === requestedTab)?.key ?? visibleTabs[0]?.key ?? "registrations";

  return (
    <div>
      {/* Header */}
      <div class="d-flex align-items-start gap-2 mb-3 flex-wrap">
        <div>
          <h5 class="mb-1">{event.name}</h5>
          <div class="text-muted small">
            <span class="mono">{event.slug}</span>
            {event.startsAt && <> · {event.startsAt.substring(0, 10)}</>}
            {event.venue && <> · {event.venue}</>}
          </div>
        </div>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void load()}>
          ↺ Refresh
        </button>
      </div>

      {/* Tabs */}
      <Tabs
        items={visibleTabs}
        active={tab}
        onChange={(key) => navigate(`/events/${slug}/${key}`)}
        className="mb-3 flex-wrap"
      />

      <Suspense fallback={<Spinner />}>
        {tab === "registrations" && <Registrations slug={slug} subTab={subTab} />}
        {tab === "proposals" && (
          <Proposals slug={slug} subTab={subTab} canWrite={event.capabilities.includes("write")} />
        )}
        {tab === "promoters" && <Promoters slug={slug} subTab={subTab} />}
        {tab === "stats" && <EventStats slug={slug} />}
        {tab === "settings" && <Settings event={event} onUpdated={handleUpdated} subTab={subTab} />}
      </Suspense>
    </div>
  );
}
