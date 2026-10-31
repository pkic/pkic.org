/**
 * A user's email addresses on the user record.
 *
 * One panel for both readers. The person themselves manage their own
 * addresses through their own endpoint: add, make a verified one primary,
 * send a waiting one a new link, remove. Staff with user write permission
 * manage another user's secondary addresses through the user's endpoint: add
 * and remove. A person holds a handful, so there is no search, sort, or pager.
 *
 * Adding an address is a form of its own, reached from the panel's menu.
 */
import { useState } from "preact/hooks";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import {
  ownEmailAddressResponseSchema,
  ownEmailAddressUpdateSchema,
  ownEmailAddressesListResponseSchema,
  ownEmailVerificationSentResponseSchema,
} from "../../../../../shared/schemas/own-email-addresses";
import { verificationLinkNotice } from "../../../../components/identities/verification-link-notice";
import { formatConjunction } from "../../../../../shared/format-list";
import { userEmailsListResponseSchema } from "../../../../../shared/schemas/user-emails";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { ApiClientError, deleteJson, getJson, patchJson, postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Menu, type MenuItem } from "../../../../ui/Menu";
import { IconCheckmark } from "../../../../ui/MediaIcons";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { RowList, RowListItem } from "../../../../ui/RowList";
import { usePortalHashLocation } from "../../hash-location";
import { toast } from "../../ui";
import { addEmailAddressPath, OWN_EMAILS_ENDPOINT } from "../../../../shared/email-address-paths";
import "./EmailAddressesPanel.css";

/** The panel's own address, so other forms on the record can lead the person to it. */
export const EMAIL_ADDRESSES_ANCHOR = "email-addresses";

interface AddressRow {
  /** The primary address of the signed-in person has no row id of its own. */
  id: string | null;
  email: string;
  primary: boolean;
  /** Whether the address is proven; null where the list does not say. */
  verified: boolean | null;
  /** Organizations whose active identity uses the address; it cannot be removed while any does. */
  usedBy: string[];
  /** Whether the address may sign in; null where the list does not say. */
  signInEnabled: boolean | null;
}

function rowMeta(address: AddressRow): string | undefined {
  const parts = [
    ...(address.primary ? ["Primary"] : address.verified === false ? ["Not verified yet"] : []),
    ...(address.usedBy.length ? [`Used by ${formatConjunction(address.usedBy, undefined)}`] : []),
  ];
  return parts.length ? parts.join(" · ") : undefined;
}

function failure(caught: unknown, fallback: string): string {
  return caught instanceof ApiClientError ? caught.message : fallback;
}

export function EmailAddressesPanel({
  userId,
  isSelf,
  primaryEmail,
}: {
  userId: string;
  /** The person's own addresses, with every action they may take on them; otherwise staff management. */
  isSelf: boolean;
  primaryEmail: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const [refusal, setRefusal] = useState<string | null>(null);
  const endpoint = isSelf ? OWN_EMAILS_ENDPOINT : `/api/v1/users/${encodeURIComponent(userId)}/emails`;
  const loaded = useData(async (): Promise<AddressRow[]> => {
    if (isSelf) {
      const response = await getJson(OWN_EMAILS_ENDPOINT, ownEmailAddressesListResponseSchema);
      return response.emails.map((address) => ({
        id: address.id ?? null,
        email: address.email,
        primary: address.primary,
        verified: Boolean(address.verifiedAt),
        usedBy: address.usedBy.map((organization) => organization.name),
        signInEnabled: address.signInEnabled,
      }));
    }
    const response = await getJson(endpoint, userEmailsListResponseSchema);
    return [
      { id: null, email: primaryEmail, primary: true, verified: null, usedBy: [], signInEnabled: null },
      ...response.emails.map((address) => ({
        id: address.id,
        email: address.email,
        primary: false,
        verified: null,
        usedBy: [],
        signInEnabled: null,
      })),
    ];
  }, [endpoint, isSelf, primaryEmail]);

  function addressEndpoint(address: AddressRow, child = ""): string {
    return `${endpoint}/${encodeURIComponent(address.id ?? "")}${child}`;
  }

  async function makePrimary(address: AddressRow): Promise<void> {
    const current = addresses.find((row) => row.primary);
    const confirmed = await confirmAction({
      title: `Make ${address.email} your primary address?`,
      consequences: [
        "We send account email to this address, and you sign in with it.",
        ...(current ? [`${current.email} stays on your account as an added address.`] : []),
        "Each organization you represent keeps the address it uses.",
      ],
      confirmLabel: "Make primary",
      tone: "primary",
    });
    if (!confirmed) return;
    setRefusal(null);
    try {
      await patchJson(
        addressEndpoint(address),
        ownEmailAddressUpdateSchema.parse({ primary: true }),
        ownEmailAddressResponseSchema,
      );
      toast(`${address.email} is now your primary address`, "success");
      // The account's address is part of the session and profile the portal holds.
      window.location.reload();
    } catch (caught) {
      setRefusal(failure(caught, "Could not change your primary address."));
    }
  }

  async function resend(address: AddressRow): Promise<void> {
    setRefusal(null);
    try {
      const sent = await postJson(
        addressEndpoint(address, "/verification"),
        {},
        ownEmailVerificationSentResponseSchema,
      );
      const notice = verificationLinkNotice(address.email, sent.delivery);
      toast(notice.message, notice.tone);
    } catch (caught) {
      setRefusal(failure(caught, "Could not send a new link."));
    }
  }

  async function remove(address: AddressRow): Promise<void> {
    const confirmed = await confirmAction({
      title: `Remove ${address.email}?`,
      body: !isSelf
        ? "This address will no longer be associated with this account."
        : address.signInEnabled
          ? "You will no longer be able to sign in with this address."
          : "This address will no longer be part of your account.",
      confirmLabel: "Remove address",
      tone: "danger",
    });
    if (!confirmed) return;
    setRefusal(null);
    try {
      await deleteJson(addressEndpoint(address), successResponseSchema);
      toast(`${address.email} removed`, "success");
      await loaded.reload();
    } catch (caught) {
      setRefusal(failure(caught, "Could not remove the address."));
    }
  }

  function actions(address: AddressRow): MenuItem[] {
    if (address.primary) return [];
    const items: MenuItem[] = [];
    if (isSelf) {
      items.push(
        address.verified
          ? { id: "primary", label: "Make primary", onSelect: () => void makePrimary(address) }
          : { id: "resend", label: "Resend verification", onSelect: () => void resend(address) },
      );
    }
    // An address an organization identity uses stays until that representation ends; the row says which.
    items.push({
      id: "remove",
      label: "Remove",
      danger: true,
      separatorBefore: items.length > 0,
      disabled: address.usedBy.length > 0,
      onSelect: () => void remove(address),
    });
    return items;
  }

  const addresses = loaded.data ?? [];

  return (
    <Panel aria-label="Email addresses" id={EMAIL_ADDRESSES_ANCHOR}>
      <PanelHeader
        title="Email addresses"
        headingLevel={2}
        menu={
          <Menu
            label="Email addresses actions"
            align="end"
            items={[
              {
                id: "add",
                label: "Add email address",
                onSelect: () => navigate(addEmailAddressPath(userId)),
              },
            ]}
          />
        }
      />
      <PanelBody flush>
        {/* A refused change needs the person's action, so it stays in the panel instead of a passing toast. */}
        {refusal && (
          <div class="pk-panel__body">
            <Alert tone="danger">{refusal}</Alert>
          </div>
        )}
        {loaded.error && (
          <div class="pk-panel__body">
            <ErrorAlert error={loaded.error} />
          </div>
        )}
        {loaded.loading && (
          <div class="pk-panel__body">
            <Spinner />
          </div>
        )}
        {addresses.length > 0 && (
          <RowList label="Email addresses">
            {addresses.map((address) => (
              <RowListItem
                key={address.id ?? "primary"}
                meta={rowMeta(address)}
                end={<RowActions subject={address.email} actions={actions(address)} />}
              >
                <span class="pk-email-address">
                  {address.email}
                  {address.verified && (
                    <IconCheckmark class="pk-email-address__verified" role="img" aria-label="Verified" />
                  )}
                </span>
              </RowListItem>
            ))}
          </RowList>
        )}
      </PanelBody>
    </Panel>
  );
}
