import { EVENT_PRODUCTION_PARTNERS_MAX } from "../../../../../../../shared/schemas/event-production-partners";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import type { CollectionLoader } from "../../../../../../hooks/useServerCollection";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { adminOrganizationCatalog } from "../../../../../../shared/management-catalogs";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { TextInput } from "../../../../../../ui/TextControl";
import "./ProductionPartnerEditor.css";

/** A partner being edited: the credit, the chosen organization and what that organization is called. */
export interface ProductionPartnerDraft {
  role: string;
  organizationId: string;
  name: string;
}

/**
 * The event's production partners as editable rows: what each is credited as, and the organization, chosen
 * from the organization list. An organization is listed once.
 */
export function ProductionPartnerEditor({
  partners,
  fieldFor,
  onChange,
  loadOrganizations,
}: {
  partners: readonly ProductionPartnerDraft[];
  /** The settings form's field state, keyed by contract path. */
  fieldFor: (path: string) => FieldPresentation;
  onChange: (partners: ProductionPartnerDraft[]) => void;
  /** Reads the organization list in place of the API, for a page that has none. */
  loadOrganizations?: CollectionLoader;
}) {
  const change = (index: number, next: Partial<ProductionPartnerDraft>) =>
    onChange(partners.map((partner, at) => (at === index ? { ...partner, ...next } : partner)));
  return (
    <>
      {partners.map((partner, index) => (
        // A new row has no organization yet, so its position is the only stable key.
        <div key={index} class="pk-production-partner-row">
          <Field label="Credited as" {...fieldFor(`productionPartners.${String(index)}.role`)}>
            {(control) => (
              <TextInput
                {...control}
                value={partner.role}
                maxLength={80}
                placeholder="Camera Technology Provider"
                onInput={(inputEvent) => change(index, { role: inputEvent.currentTarget.value })}
              />
            )}
          </Field>
          <Field label="Organization" {...fieldFor(`productionPartners.${String(index)}.organizationId`)}>
            {(control) => (
              <ServerSearchSelect
                {...control}
                searchLabel="Organization"
                catalog={adminOrganizationCatalog}
                value={partner.organizationId || null}
                selectedLabel={partner.name || undefined}
                allowEmpty={false}
                load={loadOrganizations}
                excludeValues={partners
                  .filter((other, at) => at !== index && other.organizationId)
                  .map((other) => other.organizationId)}
                onChange={(organization) =>
                  change(index, { organizationId: organization?.id ?? "", name: organization?.name ?? "" })
                }
              />
            )}
          </Field>
          <div class="pk-production-partner-row__actions">
            <Button
              variant="danger-quiet"
              aria-label={`Remove ${partner.name || `partner ${String(index + 1)}`}`}
              onClick={() => onChange(partners.filter((_, at) => at !== index))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      {partners.length < EVENT_PRODUCTION_PARTNERS_MAX && (
        <div class="pk-cluster">
          <Button onClick={() => onChange([...partners, { role: "", organizationId: "", name: "" }])}>
            + Add production partner
          </Button>
        </div>
      )}
    </>
  );
}
