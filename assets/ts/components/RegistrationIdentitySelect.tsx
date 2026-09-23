import { useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { identitiesListResponseSchema, type ActingIdentity } from "../../shared/schemas/identity";
import { userDetailResponseSchema } from "../../shared/schemas/user-management";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { getJson } from "../shared/api-client";
import { Field } from "../ui/Field";
import { ServerSearchSelect } from "./ServerSearchSelect";

const identityLabel = (identity: ActingIdentity) => identity.organizationName ?? "My individual membership";
const catalog = {
  endpoint: "/api/v1/users/current/identities",
  responseSchema: identitiesListResponseSchema,
  resolveItems: (response: z.infer<typeof identitiesListResponseSchema>) => response.identities,
  resolvePage: (response: z.infer<typeof identitiesListResponseSchema>) => response.page,
  itemKey: (identity: ActingIdentity) => identity.id,
  itemLabel: identityLabel,
  params: { active: "true" },
  sort: "organization_name",
};

/** Optional attribution. Merely opening a form never selects or activates an identity. */
export function RegistrationIdentitySelect() {
  const [session, setSession] = useState<z.infer<typeof userAuthSessionResponseSchema> | null>(null);
  const [profile, setProfile] = useState<z.infer<typeof userDetailResponseSchema>["user"] | null>(null);
  const [hasIdentities, setHasIdentities] = useState(false);
  const identityField = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<ActingIdentity | null>(null);
  useEffect(() => {
    let active = true;
    void getJson("/api/v1/auth/session", userAuthSessionResponseSchema)
      .then(async (response) => {
        if (!response.member) return;
        const available = await getJson(catalog.endpoint + "?active=true&limit=1", identitiesListResponseSchema);
        if (!available.identities.length) return;
        const detail = await getJson(
          `/api/v1/users/${encodeURIComponent(response.identity.id)}`,
          userDetailResponseSchema,
        );
        if (active) {
          setSession(response);
          setProfile(detail.user);
          setHasIdentities(true);
        }
      })
      .catch(() => {
        /* Signed-out visitors use the ordinary event form. */
      });
    return () => {
      active = false;
    };
  }, []);
  if (!session || !profile || !hasIdentities) return null;
  return (
    <Field
      label="Event identity"
      help="Optional. Use an existing identity. You can fill in any missing details for this event."
    >
      {(control) => (
        <>
          <ServerSearchSelect
            {...control}
            catalog={catalog}
            searchLabel="Your identities"
            value={selected?.id ?? null}
            selectedLabel={selected ? identityLabel(selected) : undefined}
            placeholder="Use the event form details"
            onChange={(identity) => {
              setSelected(identity);
              const form = identityField.current?.form;
              const values = {
                "custom.organization_name": identity?.organizationName,
                "custom.job_title": identity?.jobTitle,
              };
              for (const [name, value] of Object.entries(values)) {
                const field = form?.elements.namedItem(name);
                if (field instanceof HTMLInputElement) {
                  field.readOnly = Boolean(identity && value);
                  if (identity) {
                    field.value = value ?? "";
                    field.dispatchEvent(new Event("input", { bubbles: true }));
                  }
                }
              }
              if (identity) {
                for (const [name, value] of Object.entries({
                  firstName: profile.first_name,
                  lastName: profile.last_name,
                  email: session.identity.email,
                })) {
                  const field = form?.elements.namedItem(name);
                  if (field instanceof HTMLInputElement) {
                    field.value = value ?? "";
                    field.dispatchEvent(new Event("input", { bubbles: true }));
                  }
                }
              }
            }}
          />
          <input ref={identityField} type="hidden" name="identityId" value={selected?.id ?? ""} />
        </>
      )}
    </Field>
  );
}
