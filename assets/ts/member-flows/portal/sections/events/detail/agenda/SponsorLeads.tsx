import { SponsorLeadCaptures } from "./SponsorLeadCaptures";
import { useEffect, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import {
  sponsorLeadListSchema,
  sponsorLeadSponsorsSchema,
  type SponsorLeadSponsor,
} from "../../../../../../../shared/schemas/event-sponsor-lead-list";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Spinner } from "../../../../../../components/Spinner";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Menu } from "../../../../../../ui/Menu";

import { loadLiveSponsorLeads } from "./sponsor-lead-loader";
import { portalSession } from "../../../../state";
const EventScanner = lazy(() => import("../scanner/EventScanner").then((module) => ({ default: module.EventScanner })));

export function SponsorLeads({ slug, timeZone }: { slug: string; timeZone: string }) {
  return (
    <ScopedSponsorLeads key={`${slug}:${portalSession.value?.identity.id ?? ""}`} slug={slug} timeZone={timeZone} />
  );
}

function ScopedSponsorLeads({ slug, timeZone }: { slug: string; timeZone: string }) {
  const [selected, setSelected] = useState<SponsorLeadSponsor | null>(null);
  const [scanning, setScanning] = useState(false);
  const [captureHistory, setCaptureHistory] = useState<string | null>(null);
  const [live, setLive] = useState(() => navigator.onLine && document.visibilityState !== "hidden");
  const [epoch, setEpoch] = useState(0);
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
  const base = `/api/v1/events/${encodeURIComponent(slug)}/sponsors`;
  return (
    <div class="pk-stack">
      <Panel>
        <PanelHeader title="Sponsor leads" />
        <PanelBody>
          <p>
            Contacts are available only while online. Each request checks current consent and your sponsor permissions.
            Refresh removes contacts whose consent has been withdrawn. Lead capture does not record event or session
            attendance.
          </p>
        </PanelBody>
      </Panel>
      <ApiDataTable
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
              [row.canView && "View contacts", row.canCapture && "Scan leads", row.canExport && "Export"]
                .filter(Boolean)
                .join(" · "),
          },
          {
            header: "Open",
            cell: (row) => (
              <Button
                size="sm"
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
      {selected && (
        <Panel>
          <PanelHeader title={selected.name}>
            {selected.canCapture && (
              <Button variant="primary" onClick={() => setScanning(!scanning)}>
                {scanning ? "Close scanner" : "Scan leads"}
              </Button>
            )}
            <Menu
              label="Sponsor actions"
              align="end"
              items={[
                ...(selected.canExport && live
                  ? [
                      {
                        id: "export",
                        label: "Export consenting leads",
                        href: `${base}/${encodeURIComponent(selected.id)}/leads.csv`,
                      },
                    ]
                  : []),
                {
                  id: "close",
                  label: "Close sponsor",
                  onSelect: () => {
                    setSelected(null);
                    setScanning(false);
                  },
                },
              ]}
            />
          </PanelHeader>
          <PanelBody>
            {scanning && selected.canCapture ? (
              <Suspense fallback={<Spinner />}>
                <EventScanner
                  key={`${slug}:${selected.id}:${portalSession.value?.identity.id ?? ""}`}
                  slug={slug}
                  sponsorId={selected.id}
                  operatorUserId={portalSession.value?.identity.id ?? ""}
                  allowedActions={["lead"]}
                  canExportLeads={selected.canExport}
                />
              </Suspense>
            ) : selected.canView ? (
              live ? (
                <ApiDataTable
                  key={`${selected.id}:${epoch}`}
                  endpoint={`${base}/${encodeURIComponent(selected.id)}/leads`}
                  responseSchema={sponsorLeadListSchema}
                  resolve={(value) => value.leads}
                  resolvePage={(value) => value.page}
                  caption="Consenting leads"
                  paginate
                  searchPlaceholder="Search contacts…"
                  initialSort="-capturedAt"
                  load={loadLiveSponsorLeads}
                  clearDataOnReload
                  retainDataOnError={false}
                  rowKey={(row) => row.id}
                  empty="No currently consenting leads match this search."
                  detailRow={(row) =>
                    captureHistory === row.id ? (
                      <SponsorLeadCaptures
                        endpoint={`${base}/${encodeURIComponent(selected.id)}/leads/${encodeURIComponent(row.id)}/captures`}
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
                      cell: (row) => row.organization ?? "—",
                      sort: { asc: "organization", desc: "-organization" },
                    },
                    {
                      header: "Captured",
                      cell: (row) => formatDateTimeInZone(row.capturedAt, timeZone),
                      sort: { asc: "capturedAt", desc: "-capturedAt" },
                    },
                    { header: "Captured by", cell: (row) => row.operatorName ?? row.operatorUserId },
                    {
                      header: "History",
                      hideable: false,
                      cell: (row) => (
                        <Button
                          size="sm"
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
                Your sponsor scope permits {selected.canCapture ? "lead scanning" : "export"}. Viewing contact details
                requires a separate permission.
              </p>
            )}
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
