/**
 * Where the organization stands as a sponsor: the side column's card.
 *
 * A reader wants one sentence — "Gold sponsor, renews in March" or "not a
 * sponsor" — not a headed table with no rows. The current consortium
 * sponsorship, if any, is the standing; anything else on record is history
 * and belongs in the account's Sponsorships activity tab, where every
 * sponsorship, including past event ones, is listed.
 */
import { usePortalHashLocation } from "../../hash-location";
import { sponsorshipsListResponseSchema, type Sponsorship } from "../../../../../shared/schemas/sponsorship-management";
import { Badge, statusLabel } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { buildServerCollectionUrl } from "../../../../hooks/useServerCollection";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmtDate } from "../../ui";

/** The sponsorship that speaks for the organization now: active first, then the most recent in flight. */
function standing(sponsorships: readonly Sponsorship[]): Sponsorship | undefined {
  return (
    sponsorships.find((s) => s.pipelineStage === "active") ?? sponsorships.find((s) => s.pipelineStage !== "lapsed")
  );
}

export function OrganizationSponsorshipStanding({
  organizationId,
  canWrite,
}: {
  organizationId: string;
  canWrite: boolean;
}) {
  const list = useData(
    () =>
      getJson(
        buildServerCollectionUrl("/api/v1/sponsors", {
          visibility: "all",
          organizationId,
          limit: "5",
          offset: "0",
          sort: "-renewalDate",
        }),
        sponsorshipsListResponseSchema,
      ),
    [organizationId],
  );
  const current = list.data ? standing(list.data.sponsorships) : undefined;
  const others = list.data ? list.data.page.total - (current ? 1 : 0) : 0;

  return (
    <Panel aria-label="Sponsorship">
      <PanelHeader title="Sponsorship">
        {current && (
          <a class="pk-small" href={usePortalHashLocation.hrefs(`/sponsors/${encodeURIComponent(current.id)}`)}>
            Open
          </a>
        )}
      </PanelHeader>
      <PanelBody class="pk-stack pk-stack--snug">
        {list.loading && <p class="pk-muted pk-small">Checking sponsorship…</p>}
        {list.error && <ErrorAlert error={list.error} />}
        {list.data && current && (
          <>
            <p class="pk-cluster">
              <span class="pk-strong">{current.tier ?? "Sponsor"}</span>
              <Badge status={current.pipelineStage} />
            </p>
            <p class="pk-small pk-muted">
              {statusLabel(current.sponsorType)} sponsorship
              {current.eventName ? ` · ${current.eventName}` : ""}
              {current.renewalDate ? ` · renews ${fmtDate(current.renewalDate)}` : ""}
            </p>
          </>
        )}
        {list.data && !current && (
          <p class="pk-muted">
            Not a sponsor. {canWrite && <a href={usePortalHashLocation.hrefs("/sponsors")}>Create a sponsorship</a>}
          </p>
        )}
        {list.data && others > 0 && (
          <p class="pk-small pk-muted">{String(others)} more on record — see Sponsorships under Activity.</p>
        )}
      </PanelBody>
    </Panel>
  );
}
