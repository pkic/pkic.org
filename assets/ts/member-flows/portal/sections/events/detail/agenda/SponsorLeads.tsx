import { ContactOrganization } from "../../../../../../components/ContactOrganization";
import { type ClockZone } from "../../../../../../../shared/event-clock";
import { SponsorLeadCaptures } from "./SponsorLeadCaptures";
import { useEffect, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import {
  sponsorLeadListSchema,
  sponsorLeadSponsorsSchema,
  type SponsorLeadSponsor,
} from "../../../../../../../shared/schemas/event-sponsor-lead-list";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { useData } from "../../../../../../hooks/useData";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Menu } from "../../../../../../ui/Menu";

import { loadLiveSponsorLeads } from "./sponsor-lead-loader";
import { portalSession } from "../../../../state";
import { requestJson } from "../../../../../../shared/api-client";
import { scannerTransportUnavailable } from "../scanner/scanner-offline-context";
const EventScanner = lazy(() => import("../scanner/EventScanner").then((module) => ({ default: module.EventScanner })));

export function SponsorLeads({ slug, timeZone }: { slug: string; timeZone: ClockZone }) {
  return (
    <ScopedSponsorLeads key={`${slug}:${portalSession.value?.identity.id ?? ""}`} slug={slug} timeZone={timeZone} />
  );
}

function ScopedSponsorLeads({ slug, timeZone }: { slug: string; timeZone: ClockZone }) {
  const [selected, setSelected] = useState<SponsorLeadSponsor | null>(null);
  const [scanning, setScanning] = useState(false);
  const [captureHistory, setCaptureHistory] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [live, setLive] = useState(() => navigator.onLine && document.visibilityState !== "hidden");
  const [epoch, setEpoch] = useState(0);
  const base = `/api/v1/events/${encodeURIComponent(slug)}/sponsors`;
  const sponsorOptions = useData(
    () => requestJson(`${base}/leads?limit=2`, sponsorLeadSponsorsSchema, { method: "GET", cache: "no-store" }),
    [slug, listVersion],
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
  if (sponsorOptions.loading) return <Spinner label="Loading sponsor leads…" />;
  if (sponsorOptions.error || !sponsorOptions.data)
    return <ErrorAlert error={sponsorOptions.error ?? "Sponsor leads are unavailable."} />;
  const oneSponsor = sponsorOptions.data.page.total === 1;
  const current = oneSponsor ? (sponsorOptions.data.sponsors[0] ?? null) : selected;
  return (
    <div class="pk-stack">
      {sponsorOptions.data.page.total > 1 && (
        <ApiDataTable
          key={`${slug}:${listVersion}`}
          urlState="lead-sponsors"
          endpoint={`${base}/leads`}
          responseSchema={sponsorLeadSponsorsSchema}
          resolve={(value) => value.sponsors}
          resolvePage={(value) => value.page}
          caption="Authorized sponsors"
          paginate
          searchPlaceholder="Find a sponsor…"
          load={loadLiveSponsorLeads}
          clearDataOnReload
          retainDataOnError={false}
          rowKey={(row) => row.id}
          empty="No sponsor lead permissions are available for this event."
          columns={[
            { header: "Sponsor", cell: (row) => row.name, sort: { asc: "name", desc: "-name" }, hideable: false },
            {
              header: "Access",
              cell: (row) =>
                [
                  `${formatNumber(row.capturedCount)} saved ${row.capturedCount === 1 ? "lead" : "leads"}`,
                  row.canView ? "All leads" : row.canCapture && "My scans",
                  row.canExport && "Export",
                ]
                  .filter(Boolean)
                  .join(" · "),
            },
            {
              header: "Open",
              cell: (row) => (
                <Button
                  aria-label={`Open leads for ${row.name}`}
                  onClick={() => {
                    setSelected(row);
                    setScanning(false);
                  }}
                >
                  {selected?.id === row.id ? "Selected" : "Open"}
                </Button>
              ),
              hideable: false,
            },
          ]}
        />
      )}
      {sponsorOptions.data.page.total === 0 && <p>No sponsor lead access is available for this event.</p>}
      {current && (
        <Panel>
          <PanelHeader
            title={current.name}
            menu={
              current.canExport || !oneSponsor ? (
                <Menu
                  label="Sponsor actions"
                  align="end"
                  items={[
                    ...(current.canExport && live
                      ? [
                          {
                            id: "export",
                            label: "Export consenting leads",
                            href: `${base}/${encodeURIComponent(current.id)}/leads.csv`,
                          },
                        ]
                      : []),
                    ...(!oneSponsor
                      ? [
                          {
                            id: "close",
                            label: "Close sponsor",
                            onSelect: () => {
                              setSelected(null);
                              setScanning(false);
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              ) : undefined
            }
          >
            <span class="pk-small pk-muted">
              {formatNumber(current.capturedCount)} saved {current.capturedCount === 1 ? "lead" : "leads"}
            </span>
            {current.canCapture && (
              <Button
                variant="primary"
                onClick={() => {
                  if (scanning) setListVersion((value) => value + 1);
                  setScanning(!scanning);
                }}
              >
                {scanning ? "Close scanner" : "Scan leads"}
              </Button>
            )}
          </PanelHeader>
          <PanelBody flush={!(scanning && current.canCapture) && (current.canView || current.canCapture) && live}>
            {scanning && current.canCapture ? (
              <Suspense fallback={<Spinner />}>
                <EventScanner
                  key={`${slug}:${current.id}:${portalSession.value?.identity.id ?? ""}`}
                  slug={slug}
                  sponsorId={current.id}
                  sponsorName={current.name}
                  onExit={() => {
                    if (!navigator.onLine || scannerTransportUnavailable.value) return;
                    setScanning(false);
                    setListVersion((value) => value + 1);
                  }}
                  operatorUserId={portalSession.value?.identity.id ?? ""}
                  allowedActions={["lead"]}
                />
              </Suspense>
            ) : current.canView || current.canCapture ? (
              live ? (
                <ApiDataTable
                  urlState="sponsor-leads"
                  key={`${current.id}:${epoch}:${listVersion}`}
                  endpoint={`${base}/${encodeURIComponent(current.id)}/leads`}
                  responseSchema={sponsorLeadListSchema}
                  resolve={(value) => value.leads}
                  resolvePage={(value) => value.page}
                  caption={current.canView ? "Consenting leads" : "My lead scans"}
                  paginate
                  searchPlaceholder={current.canView ? "Search contacts…" : "Search my scans…"}
                  initialSort="-capturedAt"
                  load={loadLiveSponsorLeads}
                  clearDataOnReload
                  retainDataOnError={false}
                  rowKey={(row) => row.id}
                  empty={
                    current.canView
                      ? "No currently consenting leads match this search."
                      : "No saved scans with current contact sharing match this search."
                  }
                  detailRow={(row) =>
                    captureHistory === row.id ? (
                      <SponsorLeadCaptures
                        endpoint={`${base}/${encodeURIComponent(current.id)}/leads/${encodeURIComponent(row.id)}/captures`}
                        timeZone={timeZone}
                      />
                    ) : undefined
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
                    {
                      header: "Captured by",
                      cell: (row) => row.operatorName || "—",
                    },
                    {
                      header: "History",
                      hideable: false,
                      cell: (row) => (
                        <Button
                          aria-expanded={captureHistory === row.id}
                          aria-label={`View capture history for ${row.name}`}
                          onClick={() => setCaptureHistory(captureHistory === row.id ? null : row.id)}
                        >
                          {captureHistory === row.id ? "Hide history" : "View history"}
                        </Button>
                      ),
                    },
                  ]}
                />
              ) : (
                <p role="status">Reconnect to view current consenting contacts.</p>
              )
            ) : (
              <p>
                Your sponsor scope permits {current.canCapture ? "lead scanning" : "export"}. Viewing contact details
                requires a separate permission.
              </p>
            )}
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
