/**
 * The event's production partners: organizations that help produce it, each credited with what it provides.
 * They are shown under the virtual room's stream, apart from the sponsors. A partner's name, website and
 * logo are the organization's own, so only the credit and the choice of organization are edited here.
 */
import { useState } from "preact/hooks";
import type { EventProductionPartnerCredit } from "../../../../../../../shared/schemas/event-production-partners";
import { eventSettingsUpdateSchema, type EventDetail } from "../../../../../../../shared/schemas/event-management";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useData } from "../../../../../../hooks/useData";
import { Alert } from "../../../../../../ui/Alert";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { EditActions } from "../../../../../../ui/EditActions";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Spinner } from "../../../../../../ui/Spinner";
import { readEventSettings } from "../../../management/event-settings-detail";
import { portalHasGlobalPermission } from "../../../../shell/portal-navigation";
import { portalSession } from "../../../../state";
import { ProductionPartnerEditor, type ProductionPartnerDraft } from "./ProductionPartnerEditor";
import { useEventSettingsSave } from "./useEventSettingsSave";

const drafts = (partners: readonly EventProductionPartnerCredit[]): ProductionPartnerDraft[] =>
  partners.map(({ role, organizationId, name }) => ({ role, organizationId, name }));

export function ProductionPartnersSettings({
  slug,
  groupId,
  canEdit,
}: {
  slug: string;
  groupId?: string;
  /** Who may change the event's settings; everyone else reads the credits. */
  canEdit: boolean;
}) {
  const loaded = useData(() => readEventSettings(slug, groupId), [slug, groupId]);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const current = event ?? loaded.data?.event ?? null;
  if (loaded.error) return <ErrorAlert error={loaded.error} />;
  if (!current) return <Spinner label="Loading production partners…" />;
  return (
    <ProductionPartnersPanel
      key={current.updatedAt}
      event={current}
      // Choosing an organization reads the organization list, which not every event manager may.
      canEdit={canEdit && portalHasGlobalPermission(portalSession.value, "organizations:read")}
      onUpdated={setEvent}
      groupTarget={
        groupId
          ? { groupId, eventId: current.id, canEdit: true, onSaved: () => loaded.reload().then(() => setEvent(null)) }
          : undefined
      }
    />
  );
}

export function ProductionPartnersPanel({
  event,
  canEdit,
  onUpdated,
  groupTarget,
}: {
  event: Pick<EventDetail, "slug" | "updatedAt" | "productionPartners">;
  canEdit: boolean;
  onUpdated: (event: EventDetail) => void;
  groupTarget?: Parameters<typeof useEventSettingsSave>[3];
}) {
  const saved = event.productionPartners;
  const [partners, setPartners] = useState<ProductionPartnerDraft[]>(() => drafts(saved));
  const form = useContractForm(eventSettingsUpdateSchema, {
    expectedUpdatedAt: event.updatedAt,
    productionPartners: partners.map(({ role, organizationId }) => ({ role, organizationId })),
  });
  const { editing, setEditing, saving, error, setError, save } = useEventSettingsSave(
    event.slug,
    form,
    onUpdated,
    groupTarget,
  );
  function reset() {
    setPartners(drafts(saved));
    form.reset();
    setError("");
  }
  return (
    <Panel aria-label="Production partners">
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title="Production partners">
          {canEdit && (
            <EditActions
              label="Production partner actions"
              editing={editing}
              saving={saving}
              saveLabel="Save partners"
              editLabel="Edit partners"
              onEdit={() => {
                reset();
                setEditing(true);
              }}
              onCancel={() => {
                reset();
                setEditing(false);
              }}
            />
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          <p class="pk-muted pk-small">
            Organizations that help produce this event. Each is credited under the virtual room’s stream with what it
            provides, apart from the sponsors. The name, website and logo come from the organization.
          </p>
          {editing && canEdit ? (
            <ProductionPartnerEditor partners={partners} fieldFor={form.of} onChange={setPartners} />
          ) : saved.length ? (
            <DescriptionList
              items={saved.map((partner) => ({
                key: partner.organizationId,
                term: partner.role,
                value: partner.name,
              }))}
            />
          ) : (
            <p class="pk-muted">No production partners.</p>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}
