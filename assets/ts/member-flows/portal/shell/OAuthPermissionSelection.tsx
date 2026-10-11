import { Field } from "../../../ui/Field";
import { PERMISSION_METADATA } from "../../../../shared/schemas/permission-metadata";
import type { Permission } from "../../../../shared/schemas/permissions";
import type { PublicStaffCapacity } from "../../../../shared/schemas/staff-capacity";
import { Checkbox } from "../../../ui/Checkbox";
import { Button } from "../../../ui/Button";

export function readOnlyPermissionScopes(scopes: Permission[]): Permission[] {
  return scopes.filter((scope) => PERMISSION_METADATA[scope].access === "read");
}

export function OAuthPermissionSelection({
  requested,
  available,
  selected,
  grants = [],
  disabled,
  onChange,
}: {
  requested: Permission[];
  available: Permission[];
  selected: Permission[];
  grants?: PublicStaffCapacity["grants"];
  disabled?: boolean;
  onChange: (scopes: Permission[]) => void;
}) {
  const domains = [...new Set(requested.map((scope) => PERMISSION_METADATA[scope].domain))];
  return (
    <div class="pk-stack">
      {domains.map((domain) => {
        const scopes = requested.filter((scope) => PERMISSION_METADATA[scope].domain === domain);
        const allowed = scopes.filter((scope) => available.includes(scope));
        const label = PERMISSION_METADATA[scopes[0]].domainLabel;
        function preset(values: Permission[]) {
          onChange([...selected.filter((scope) => !scopes.includes(scope)), ...values]);
        }
        return (
          <Field group label={label} key={domain}>
            {() => (
              <div class="pk-stack pk-stack--snug">
                <div class="pk-cluster">
                  <Button size="sm" disabled={disabled} onClick={() => preset([])}>
                    No {label.toLowerCase()} access
                  </Button>
                  <Button
                    size="sm"
                    disabled={disabled || allowed.length === 0}
                    onClick={() => preset(readOnlyPermissionScopes(allowed))}
                  >
                    Read-only {label.toLowerCase()}
                  </Button>
                  <Button size="sm" disabled={disabled || allowed.length === 0} onClick={() => preset(allowed)}>
                    Read and write {label.toLowerCase()}
                  </Button>
                </div>
                {scopes.map((scope) => {
                  const metadata = PERMISSION_METADATA[scope];
                  const limits = grants.filter((grant) => grant.permission === scope);
                  const hint = !available.includes(scope)
                    ? "Unavailable for your account"
                    : limits.some((grant) => grant.contextType === null) || limits.length === 0
                      ? scope
                      : `${scope} · Limited to ${limits.map((grant) => `${grant.contextType}: ${grant.contextId}`).join(", ")}`;
                  return (
                    <Checkbox
                      key={scope}
                      label={`${metadata.actionLabel} ${label.toLowerCase()}`}
                      aria-label={`${metadata.actionLabel} ${label.toLowerCase()}`}
                      aria-description={hint}
                      hint={hint}
                      disabled={disabled || !available.includes(scope)}
                      checked={selected.includes(scope)}
                      onChange={(event) =>
                        onChange(
                          event.currentTarget.checked
                            ? [...selected, scope]
                            : selected.filter((item) => item !== scope),
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
          </Field>
        );
      })}
      <div class="pk-stack pk-stack--tight" aria-live="polite">
        <h3 class="pk-small pk-strong">Selected permissions ({selected.length})</h3>
        {selected.length ? (
          <ul class="pk-answer-list">
            {selected.map((scope) => (
              <li key={scope}>
                {PERMISSION_METADATA[scope].domainLabel}: {PERMISSION_METADATA[scope].actionLabel}
              </li>
            ))}
          </ul>
        ) : (
          <p class="pk-muted">No access selected. Choose a permission or deny access.</p>
        )}
      </div>
    </div>
  );
}
