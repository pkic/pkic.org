/**
 * The consent an MCP client asks for: who wants access, what it may do, and
 * as whom. It follows the pattern people know from other app connections:
 * the two marks and the request on top, then one card with the permissions on
 * one side and the account and the decision on the other.
 *
 * Access is chosen in the shared permission matrix. Authorizing with nothing
 * chosen is not offered.
 */
import type { z } from "zod";
import type { mcpOauthContextSchema } from "../../../../shared/schemas/mcp-oauth";
import { type MatrixArea, PermissionMatrix } from "../../../components/PermissionMatrix";
import { Alert } from "../../../ui/Alert";
import { Avatar } from "../../../ui/Avatar";
import { Button } from "../../../ui/Button";
import { IconChevron } from "../../../ui/MediaIcons";
import { PkicMark } from "../../../ui/PkicMark";
import "./McpConsent.css";

export type ConsentArea = z.infer<typeof mcpOauthContextSchema>["areas"][number];

export interface ConsentAccount {
  name: string;
  email: string;
  headshotUrl: string | null;
  /** The identity the access acts as: "Personal" or the organization. */
  actingAs: string;
}

const LIMITED = "Limited to where you have this permission";

/** The contract's areas as matrix rows: a permission held only in some places says so. */
function matrixAreas(areas: readonly ConsentArea[]): MatrixArea[] {
  return areas.map((area) => ({
    key: area.key,
    label: area.label,
    note: area.permissions.some((item) => !item.allResources) ? LIMITED : undefined,
    permissions: area.permissions.map((item) => ({
      permission: item.permission,
      label: item.label,
      access: item.access,
      hint: item.allResources ? undefined : LIMITED,
    })),
  }));
}

export function McpConsent({
  clientName,
  clientHost,
  account,
  areas,
  selected,
  busy,
  error,
  onSelect,
  onAuthorize,
  onCancel,
}: {
  clientName: string;
  /** Where the client returns to after the decision. */
  clientHost: string;
  account: ConsentAccount;
  areas: readonly ConsentArea[];
  selected: ReadonlySet<string>;
  busy: boolean;
  error: string | null;
  onSelect: (next: Set<string>) => void;
  onAuthorize: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="pk pk-consent">
      <header class="pk-consent__head">
        <div class="pk-consent__marks" aria-hidden="true">
          <Avatar name={clientName} size="lg" />
          <span class="pk-consent__link">
            <IconChevron pointing="right" />
          </span>
          <PkicMark class="pk-consent__pkic" />
        </div>
        <h1 class="pk-consent__title">{clientName} wants to access your account</h1>
        <p class="pk-small pk-muted">Returns to {clientHost}</p>
      </header>

      <section class="pk-consent__card" aria-label="Access request">
        <div class="pk-consent__scopes">
          <PermissionMatrix areas={matrixAreas(areas)} selected={selected} disabled={busy} onSelect={onSelect} />
        </div>

        <div class="pk-consent__decision">
          <div class="pk-consent__account">
            <Avatar name={account.name} src={account.headshotUrl ?? undefined} />
            <div class="pk-consent__account-text">
              <p class="pk-strong">{account.name}</p>
              <p class="pk-small pk-muted">{account.email}</p>
            </div>
          </div>
          <div class="pk-consent__account">
            <span class="pk-small pk-muted">Acting as</span>
            <span class="pk-strong">{account.actingAs}</span>
          </div>
          <div class="pk-consent__note">
            <p class="pk-small">Only authorize apps you trust.</p>
            <p class="pk-small pk-muted">Access ends when you sign out or this sign-in expires.</p>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div class="pk-consent__actions">
            <Button variant="primary" loading={busy} disabled={busy || selected.size === 0} onClick={onAuthorize}>
              Authorize
            </Button>
            <Button disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
