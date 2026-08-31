import { useRef, useState } from "preact/hooks";
import {
  effectiveMailingListSubscriptionsResponseSchema,
  mailingListPreferenceMutationResponseSchema,
  type EffectiveMailingListSubscription,
  type MailingListPreferenceMutationInput,
} from "../../../../../shared/schemas/mailing-lists";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { putJson } from "../../../../shared/api-client";

function SubscriptionPreference({
  subscription,
  disabled,
  onChange,
}: {
  subscription: EffectiveMailingListSubscription;
  disabled: boolean;
  onChange: (preference: MailingListPreferenceMutationInput["preference"]) => void;
}) {
  return (
    <select
      class="form-select form-select-sm"
      aria-label={`Subscription preference for ${subscription.mailingList.label}`}
      value={subscription.preference ?? "inherit"}
      disabled={disabled || !subscription.eligible}
      onChange={(event) =>
        onChange((event.currentTarget as HTMLSelectElement).value as MailingListPreferenceMutationInput["preference"])
      }
    >
      <option value="inherit">Use group default</option>
      <option value="subscribed">Subscribed</option>
      <option value="unsubscribed">Unsubscribed</option>
    </select>
  );
}

/** Member-only preferences; list configuration is deliberately kept in the manager component. */
export function GroupMailingListPreferences({ groupId }: { groupId: string }) {
  const actions = useRef<ApiTableActions | null>(null);
  const [pendingListId, setPendingListId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  async function updatePreference(
    subscription: EffectiveMailingListSubscription,
    preference: MailingListPreferenceMutationInput["preference"],
  ) {
    setPendingListId(subscription.mailingList.id);
    setError(null);
    try {
      await putJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(subscription.mailingList.id)}/subscription`,
        { preference },
        mailingListPreferenceMutationResponseSchema,
      );
      await actions.current?.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not update the subscription preference"));
    } finally {
      setPendingListId(null);
    }
  }

  return (
    <section class="card border-0 shadow-sm" aria-label="My mailing-list preferences">
      <div class="card-header bg-white fw-semibold">My mailing-list preferences</div>
      <div class="card-body">
        {error && <ErrorAlert error={error} />}
        <ApiDataTable
          caption="My mailing-list preferences"
          actionsRef={actions}
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists`}
          responseSchema={effectiveMailingListSubscriptionsResponseSchema}
          resolve={(response) => response.subscriptions}
          resolvePage={(response) => response.page}
          paginate
          searchPlaceholder="Search mailing lists…"
          initialSort="label"
          columns={[
            {
              header: "Mailing list",
              cell: (subscription) => (
                <div>
                  <div class="fw-semibold">{subscription.mailingList.label}</div>
                  <div class="small text-muted">{subscription.mailingList.email}</div>
                </div>
              ),
              sort: { asc: "label", desc: "-label" },
            },
            {
              header: "Purpose",
              cell: (subscription) => subscription.mailingList.purpose.replaceAll("_", " "),
              sort: { asc: "purpose", desc: "-purpose" },
            },
            {
              header: "Effective status",
              cell: (subscription) => (subscription.effectiveSubscribed ? "Subscribed" : "Not subscribed"),
            },
            {
              header: "Preference",
              cell: (subscription) => (
                <SubscriptionPreference
                  subscription={subscription}
                  disabled={pendingListId === subscription.mailingList.id}
                  onChange={(preference) => void updatePreference(subscription, preference)}
                />
              ),
            },
          ]}
          empty="No mailing lists are available through this group."
          rowKey={(subscription) => subscription.mailingList.id}
        />
      </div>
    </section>
  );
}
