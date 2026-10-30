import { personLegalName } from "../../shared/person-display";
import { z } from "zod";
import { userCatalogListResponseSchema, type UserCatalogItem } from "../../shared/schemas/user-catalog";
import type { FieldControlProps } from "../ui/Field";
import { PersonCell } from "../ui/PersonCell";
import { SearchPicker } from "./SearchPicker";

export interface PickedUser {
  id: string;
  email: string;
  /** What the catalog knew the person as, so a form can prefill a name it also has to ask for. */
  firstName?: string | null;
  lastName?: string | null;
}

/** Debounced, bounded server search for selecting an existing user. */
export function UserPicker({
  value,
  onChange,
  disabled,
  placeholder = "Search by email or name…",
  endpoint = "/api/v1/users",
  inputProps,
  responseSchema = userCatalogListResponseSchema,
  sort = "email",
  emptyMessage = "No matching users found.",
}: {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  disabled?: boolean;
  placeholder?: string;
  endpoint?: string;
  responseSchema?: z.ZodType<z.infer<typeof userCatalogListResponseSchema>>;
  sort?: string;
  inputProps?: FieldControlProps & { name?: string };
  emptyMessage?: string;
}) {
  const nameOf = (user: {
    email?: string;
    first_name?: string | null;
    last_name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }) =>
    personLegalName(
      { firstName: user.first_name ?? user.firstName, lastName: user.last_name ?? user.lastName },
      user.email,
    );
  return (
    <SearchPicker<z.infer<typeof userCatalogListResponseSchema>, UserCatalogItem>
      picked={value ? value.email || nameOf(value) : null}
      onPick={(user) =>
        onChange({ id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name })
      }
      onClear={() => onChange(null)}
      endpoint={endpoint}
      responseSchema={responseSchema}
      rows={(data) => data.users}
      rowKey={(user) => user.id}
      rowText={(user) => user.email || nameOf(user)}
      noun={["user", "users"]}
      label="Search for a user"
      resultsLabel="Matching users"
      sort={sort}
      disabled={disabled}
      placeholder={placeholder}
      inputProps={inputProps}
      emptyMessage={emptyMessage}
      errorMessage="Could not search users."
      renderRow={(user) => {
        const name = nameOf(user);
        const detail = user.organization_name || user.job_title ? undefined : "Appears as themselves";
        return (
          <PersonCell
            name={name}
            title={user.job_title}
            organization={user.organization_name}
            avatarSrc={user.headshotUrl}
            detail={detail}
            size="sm"
          />
        );
      }}
    />
  );
}
