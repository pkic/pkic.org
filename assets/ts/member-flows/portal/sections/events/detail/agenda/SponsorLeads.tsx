import { ContactOrganization } from "../../../../../../components/ContactOrganization";
import { type ClockZone } from "../../../../../../../shared/event-clock";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import {
  sponsorLeadListSchema,
  sponsorLeadSponsorsSchema,
  type SponsorLeadSponsor,
  type SponsorLead,
  sponsorLeadRemovalResponseSchema,
} from "../../../../../../../shared/schemas/event-sponsor-lead-list";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { useData } from "../../../../../../hooks/useData";
import { Button } from "../../../../../../ui/Button";
import { RowActions } from "../../../../../../ui/RowActions";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Menu } from "../../../../../../ui/Menu";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import type { ServerCatalog } from "../../../../../../shared/server-catalog";
import type { z } from "zod";

import { loadLiveSponsorLeads } from "./sponsor-lead-loader";
import { portalSession } from "../../../../state";
import { deleteJson, requestJson } from "../../../../../../shared/api-client";
import { toast } from "../../../../ui";
import { usePortalHashLocation } from "../../../../hash-location";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { databaseIdSchema } from "../../../../../../../shared/schemas/identifiers";
import { SponsorLeadDetail } from "./SponsorLeadDetail";
const EventScanner = lazy(() => import("../scanner/EventScanner").then((module) => ({ default: module.EventScanner })));

export function SponsorLeads({
  slug,
  timeZone,
  sponsorId,
  leadId,
}: {
  slug: string;
  timeZone: ClockZone;
  sponsorId?: string;
  leadId?: string;
}) {
  if (sponsorId && leadId)
    return <SponsorLeadDetail slug={slug} sponsorId={sponsorId} leadId={leadId} timeZone={timeZone} />;
  return (
    <ScopedSponsorLeads key={`${slug}:${portalSession.value?.identity.id ?? ""}`} slug={slug} timeZone={timeZone} />
  );
}

function ScopedSponsorLeads({ slug, timeZone }: { slug: string; timeZone: ClockZone }) {
  const [selected, setSelected] = useState<SponsorLeadSponsor | null>(null);
  const [selectedSponsorParam, setSelectedSponsorParam] = useHashQueryParam("leadSponsor", "");
  const selectedSponsorId = databaseIdSchema.safeParse(selectedSponsorParam).success ? selectedSponsorParam : "";
  const [scanning, setScanning] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [live, setLive] = useState(() => navigator.onLine && document.visibilityState !== "hidden");
  const [epoch, setEpoch] = useState(0);
  const [removingLeadId, setRemovingLeadId] = useState<string | null>(null);
  const [removalError, setRemovalError] = useState("");
  const [restoreFocus, setRestoreFocus] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const base = `/api/v1/events/${encodeURIComponent(slug)}/sponsors`;
  const sponsorCatalog = useMemo(
    (): ServerCatalog<SponsorLeadSponsor, z.infer<typeof sponsorLeadSponsorsSchema>> => ({
      endpoint: `${base}/leads`,
      responseSchema: sponsorLeadSponsorsSchema,
      resolveItems: (response) => response.sponsors,
      resolvePage: (response) => response.page,
      itemKey: (sponsor) => sponsor.id,
      itemLabel: (sponsor) => sponsor.name,
      sort: "name",
    }),
    [base],
  );
  const sponsorOptions = useData(
    () => requestJson(`${base}/leads?limit=2`, sponsorLeadSponsorsSchema, { method: "GET", cache: "no-store" }),
    [slug, listVersion],
  );
  const reloadSponsorOptions = sponsorOptions.reload;
  const lookupId =
    selectedSponsorId &&
    sponsorOptions.data?.page.total !== 1 &&
    !sponsorOptions.data?.sponsors.some((sponsor) => sponsor.id === selectedSponsorId)
      ? selectedSponsorId
      : "";
  const selectedOption = useData(
    () =>
      lookupId
        ? requestJson(
            `${base}/leads?${new URLSearchParams({ sponsorId: lookupId, limit: "1" })}`,
            sponsorLeadSponsorsSchema,
            { method: "GET", cache: "no-store" },
          )
        : Promise.resolve(null),
    [slug, lookupId],
  );
  useEffect(() => {
    const changed = () => {
      setLive(navigator.onLine && document.visibilityState !== "hidden");
      setEpoch((value) => value + 1);
    };
    window.addEventListener("focus", changed);
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    document.addEventListener("visibilitychange", changed);
    return () => {
      window.removeEventListener("focus", changed);
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
      document.removeEventListener("visibilitychange", changed);
    };
  }, []);
  useEffect(() => {
    if (scanning || !restoreFocus || sponsorOptions.loading) return;
    const button = host.current?.querySelector<HTMLButtonElement>('button[aria-label="Scan leads"]');
    if (button) {
      button.focus();
      setRestoreFocus(false);
    }
  }, [scanning, restoreFocus, sponsorOptions.loading, sponsorOptions.data, live]);
  useEffect(() => {
    if (!sponsorOptions.error || scanning) return;
    const retry = () => void reloadSponsorOptions();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [sponsorOptions.error, reloadSponsorOptions, scanning]);
  useEffect(() => {
    if (lookupId && !selectedOption.loading && selectedOption.data?.page.total === 0) setSelectedSponsorParam("");
  }, [lookupId, selectedOption.loading, selectedOption.data, setSelectedSponsorParam]);
  useEffect(() => {
    if (selectedSponsorParam && (!selectedSponsorId || sponsorOptions.data?.page.total === 1))
      setSelectedSponsorParam("");
  }, [selectedSponsorParam, selectedSponsorId, sponsorOptions.data, setSelectedSponsorParam]);
  if (sponsorOptions.loading) return <Spinner label="Loading sponsor leads…" />;
  if (sponsorOptions.error || !sponsorOptions.data)
    return (
      <div class="pk-stack">
        <ErrorAlert error={sponsorOptions.error ?? "Sponsor leads are unavailable."} />
        <Button onClick={() => void sponsorOptions.reload()}>Try again</Button>
      </div>
    );
  const oneSponsor = sponsorOptions.data.page.total === 1;
  const current = oneSponsor
    ? (sponsorOptions.data.sponsors[0] ?? null)
    : selectedSponsorId
      ? ((selected?.id === selectedSponsorId ? selected : null) ??
        sponsorOptions.data.sponsors.find((sponsor) => sponsor.id === selectedSponsorId) ??
        selectedOption.data?.sponsors[0] ??
        (selectedOption.loading ? null : (sponsorOptions.data.sponsors[0] ?? null)))
      : (sponsorOptions.data.sponsors[0] ?? null);
  async function removeLead(lead: SponsorLead, scope: "mine" | "all") {
    if (!current) return;
    const all = scope === "all";
    if (
      !(await confirmAction({
        title: all ? `Remove ${lead.name} for ${current.name}?` : `Remove your scans of ${lead.name}?`,
        body: all
          ? "This removes this contact from the sponsor's lead list. A new scan can add them again."
          : "Your scans will no longer count toward this lead. Other staff members' scans remain available.",
        confirmLabel: all ? "Remove sponsor lead" : "Remove my scans",
        tone: "danger",
      }))
    )
      return;
    setRemovingLeadId(lead.id);
    setRemovalError("");
    try {
      const path = `${base}/${encodeURIComponent(current.id)}/leads/${encodeURIComponent(lead.id)}${all ? "" : "/captures"}`;
      await deleteJson(path, sponsorLeadRemovalResponseSchema);
      setListVersion((value) => value + 1);
      toast(all ? "Lead removed for this sponsor" : "Your scans removed", "success");
    } catch (cause) {
      setRemovalError(cause instanceof Error ? cause.message : "Could not remove this lead.");
    } finally {
      setRemovingLeadId(null);
    }
  }
  return (
    <div ref={host} class="pk-stack">
      {sponsorOptions.data.page.total > 1 && (
        <Field label="Sponsor">
          {(control) => (
            <ServerSearchSelect
              {...control}
              catalog={sponsorCatalog}
              load={loadLiveSponsorLeads}
              searchLabel="Sponsor"
              allowEmpty={false}
              value={current?.id ?? (selectedSponsorId || null)}
              selectedLabel={current?.name}
              onChange={(sponsor) => {
                if (!sponsor) return;
                setSelected(sponsor);
                setSelectedSponsorParam(sponsor.id);
                setScanning(false);
              }}
            />
          )}
        </Field>
      )}
      {sponsorOptions.data.page.total === 0 && <p>No sponsor lead access is available for this event.</p>}
      {current && (
        <>
          {oneSponsor && !scanning && (current.canView || current.canCapture) && (
            <p class="pk-small pk-muted">{current.name}</p>
          )}
          {scanning && current.canCapture ? (
            <Suspense fallback={<Spinner />}>
              <EventScanner
                key={`${slug}:${current.id}:${portalSession.value?.identity.id ?? ""}`}
                slug={slug}
                sponsorId={current.id}
                sponsorName={current.name}
                onExit={() => {
                  setScanning(false);
                  if (navigator.onLine) setListVersion((value) => value + 1);
                  setRestoreFocus(true);
                }}
                operatorUserId={portalSession.value?.identity.id ?? ""}
                allowedActions={["lead"]}
              />
            </Suspense>
          ) : current.canView || current.canCapture ? (
            live ? (
              <ApiDataTable<SponsorLead, z.infer<typeof sponsorLeadListSchema>>
                urlState="sponsor-leads"
                key={`${current.id}:${epoch}:${listVersion}`}
                endpoint={`${base}/${encodeURIComponent(current.id)}/leads`}
                responseSchema={sponsorLeadListSchema}
                resolve={(value) => value.leads}
                resolvePage={(value) => value.page}
                caption={current.canView ? "Consenting leads" : "My lead scans"}
                paginate
                createAction={
                  current.canCapture ? { label: "Scan leads", onSelect: () => setScanning(true) } : undefined
                }
                toolbar={
                  current.canExport
                    ? () => (
                        <Menu
                          label="Sponsor actions"
                          align="end"
                          items={[
                            {
                              id: "export",
                              label: "Export consenting leads",
                              href: `${base}/${encodeURIComponent(current.id)}/leads.csv`,
                            },
                          ]}
                        />
                      )
                    : undefined
                }
                searchPlaceholder={current.canView ? "Search contacts…" : "Search my scans…"}
                initialSort="-capturedAt"
                load={loadLiveSponsorLeads}
                clearDataOnReload
                retainDataOnError={false}
                rowKey={(row) => row.id}
                inset={removalError ? <ErrorAlert error={removalError} /> : undefined}
                rowAction={(row) => ({
                  label: `View lead ${row.name}`,
                  href: usePortalHashLocation.hrefs(
                    `/events/${encodeURIComponent(slug)}/leads/${encodeURIComponent(current.id)}/${encodeURIComponent(row.id)}`,
                  ),
                })}
                empty={
                  current.canView
                    ? "No currently consenting leads match this search."
                    : "No saved scans with current contact sharing match this search."
                }
                columns={[
                  {
                    header: "Name",
                    cell: (row) => row.name ?? "—",
                    sort: { asc: "name", desc: "-name" },
                    hideable: false,
                  },
                  { header: "Email", cell: (row) => row.email ?? "—", sort: { asc: "email", desc: "-email" } },
                  {
                    header: "Organization",
                    cell: (row) => (
                      <ContactOrganization
                        audience="sponsor"
                        organization={row.organization}
                        personalEmail={row.personalEmail}
                      />
                    ),
                    sort: { asc: "organization", desc: "-organization" },
                  },
                  {
                    header: "Captured",
                    cell: (row) => formatDateTimeInZone(row.capturedAt, timeZone),
                    sort: { asc: "capturedAt", desc: "-capturedAt" },
                  },
                  ...(current.canCapture || current.canRemoveAll
                    ? [
                        {
                          header: "Actions",
                          width: "fit" as const,
                          hideable: false,
                          cell: (row: SponsorLead) => (
                            <RowActions
                              subject={row.name}
                              actions={[
                                ...(current.canCapture
                                  ? [
                                      {
                                        id: "remove-own",
                                        label: "Remove my scans",
                                        danger: true,
                                        disabled: removingLeadId === row.id,
                                        onSelect: () => void removeLead(row, "mine"),
                                      },
                                    ]
                                  : []),
                                ...(current.canRemoveAll
                                  ? [
                                      {
                                        id: "remove-all",
                                        label: "Remove lead for sponsor",
                                        danger: true,
                                        disabled: removingLeadId === row.id,
                                        onSelect: () => void removeLead(row, "all"),
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <div class="pk-stack">
                <p role="status">Reconnect to view current consenting contacts.</p>
                {current.canCapture && (
                  <Button aria-label="Scan leads" onClick={() => setScanning(true)}>
                    Scan leads
                  </Button>
                )}
              </div>
            )
          ) : (
            <Panel>
              <PanelHeader
                title={current.name}
                menu={
                  current.canExport && live ? (
                    <Menu
                      label="Sponsor actions"
                      align="end"
                      items={[
                        {
                          id: "export",
                          label: "Export consenting leads",
                          href: `${base}/${encodeURIComponent(current.id)}/leads.csv`,
                        },
                      ]}
                    />
                  ) : undefined
                }
              />
              <PanelBody>
                <p>Viewing contact details requires a separate permission.</p>
              </PanelBody>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
