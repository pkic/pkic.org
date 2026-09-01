import { useState, useEffect, useCallback } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { usePortalHashLocation } from "../../../hash-location";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Tabs } from "../../../../../components/Tabs";
import { getJson } from "../../../../../shared/api-client";
import { eventManagementDetailResponseSchema } from "../../../../../../shared/schemas/event-management";
import { toast } from "../../../ui";
import type { EventDetail } from "../types";
import { currentEvent } from "../state";
import { Button } from "../../../../../ui/Button";
import "../../../../../ui/Content.css";

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
  const [, navigate] = usePortalHashLocation();
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
    <div class="pk pk-stack">
      {/* Header. `--start` keeps the refresh button level with the event's
          name rather than centered against a two-line title block. */}
      <div class="pk-cluster pk-cluster--start">
        <div class="pk-stack pk-stack--tight">
          <h2>{event.name}</h2>
          <p class="pk-small">
            <span class="pk-mono">{event.slug}</span>
            {event.startsAt && <> · {event.startsAt.substring(0, 10)}</>}
            {event.venue && <> · {event.venue}</>}
          </p>
        </div>
        <Button class="pk-push" size="sm" onClick={() => void load()}>
          ↺ Refresh
        </Button>
      </div>

      {/* Tabs. Named, because the page carries more than one set of them once
          a tab's own sub-navigation renders below. */}
      <Tabs
        items={visibleTabs}
        active={tab}
        label="Event sections"
        onChange={(key) => navigate(`/events/${slug}/${key}`)}
        hrefFor={(key) => `/events/${slug}/${key}`}
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
