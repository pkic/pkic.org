import { useMemo } from "preact/hooks";
import type { ActingIdentity } from "../../../shared/schemas/identity";
import { actingIdentityCatalog, actingIdentityLabel } from "../../shared/acting-identity-catalog";
import type { FieldPresentation } from "../../hooks/useContractForm";
import { Field } from "../../ui/Field";
import { InputGroup } from "../../ui/InputGroup";
import { Button } from "../../ui/Button";
import { IconPlus, IconPencil } from "../icons";
import { ServerSearchSelect } from "../ServerSearchSelect";
import type { CollectionLoader } from "../../hooks/useServerCollection";

type RepresentationValue = Pick<ActingIdentity, "id" | "organizationName" | "jobTitle">;
const label = (identity: RepresentationValue) =>
  actingIdentityLabel({ organizationName: identity.organizationName, jobTitle: identity.jobTitle });

/** The canonical representation picker; collection authority and creation stay with its caller. */
export function RepresentationSelect({
  endpoint = "/api/v1/users/current/identities",
  userId,
  value,
  onSelect,
  onAdd,
  onEdit,
  validation,
  excludeIdentityId,
  excludeOrganizationId,
  organizationOnly = false,
  required = false,
  load,
}: {
  endpoint?: string;
  userId?: string;
  value: RepresentationValue | null;
  onSelect: (identity: ActingIdentity) => void;
  onAdd?: () => void;
  onEdit?: () => void;
  validation?: FieldPresentation;
  excludeIdentityId?: string;
  excludeOrganizationId?: string;
  organizationOnly?: boolean;
  required?: boolean;
  load?: CollectionLoader;
}) {
  const catalog = useMemo(() => {
    const params: Record<string, string> = { active: "true" };
    if (userId) params.userId = userId;
    if (organizationOnly) params.organizationOnly = "true";
    if (excludeIdentityId) params.excludeIdentityId = excludeIdentityId;
    if (excludeOrganizationId) params.excludeOrganizationId = excludeOrganizationId;
    return actingIdentityCatalog(endpoint, label, params);
  }, [endpoint, userId, organizationOnly, excludeIdentityId, excludeOrganizationId]);
  return (
    <Field label="Representation" required={required} {...validation}>
      {(control) => (
        <InputGroup>
          <ServerSearchSelect
            {...control}
            catalog={catalog}
            load={load}
            searchable={false}
            allowEmpty={false}
            searchLabel="Your identities"
            value={value?.id ?? null}
            selectedLabel={value ? label(value) : undefined}
            placeholder="Choose an existing identity"
            onChange={(identity) => {
              if (identity) onSelect(identity);
            }}
          />
          {onEdit && value && (
            <Button
              type="button"
              variant="secondary"
              icon
              aria-label="Edit representation"
              title="Edit representation"
              onClick={onEdit}
            >
              <IconPencil />
            </Button>
          )}
          {onAdd && (
            <Button
              type="button"
              variant="secondary"
              icon
              aria-label="Add identity"
              title="Add identity"
              onClick={onAdd}
            >
              <IconPlus />
            </Button>
          )}
        </InputGroup>
      )}
    </Field>
  );
}
