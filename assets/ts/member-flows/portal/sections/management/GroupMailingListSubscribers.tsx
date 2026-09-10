import {
  mailingListSubscribersResponseSchema,
  type MailingListSubscriber,
} from "../../../../../shared/schemas/mailing-lists";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { EmptyState } from "../../../../components/EmptyState";
import { Badge } from "../../../../ui/Badge";

/** The person, named the way the rest of the portal names people: their name, with the address under it. */
function personName(subscriber: MailingListSubscriber): string {
  const { first_name: firstName, last_name: lastName, email } = subscriber.user;
  return [firstName, lastName].filter(Boolean).join(" ") || email;
}

/**
 * Why this person stands where they do. A recorded preference is the person's
 * own decision and outranks the list's default, so it is what the column says;
 * otherwise the standing came from the list's configuration, or from the fact
 * that the list was never open to them at all.
 */
function standingReason(subscriber: MailingListSubscriber): string {
  if (!subscriber.eligible) return "Not eligible for this list";
  if (subscriber.preference === "subscribed") return "Asked to be subscribed";
  if (subscriber.preference === "unsubscribed") return "Asked to be unsubscribed";
  return subscriber.defaultSubscribed ? "List default" : "Not subscribed by default";
}

/**
 * Who this list reaches.
 *
 * Every column is answered by D1: the search, the subscribed/not filter, the
 * ordering, and the count. Nothing is narrowed here after the fact, so what
 * the pager says is what the server counted.
 */
export function GroupMailingListSubscribers({ groupId, listId }: { groupId: string; listId: string }) {
  return (
    <ApiDataTable
      caption="Mailing-list subscribers"
      endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/mailing-lists/${encodeURIComponent(listId)}/subscribers`}
      responseSchema={mailingListSubscribersResponseSchema}
      resolve={(response) => response.subscribers}
      resolvePage={(response) => response.page}
      paginate
      searchPlaceholder="Search subscribers…"
      initialSort="email"
      columns={[
        {
          header: "Person",
          cell: (subscriber) => (
            <div class="pk-stack pk-stack--tight">
              <span class="pk-strong">{personName(subscriber)}</span>
              <span class="pk-small pk-break">{subscriber.user.email}</span>
            </div>
          ),
          sort: { asc: "last_name", desc: "-last_name" },
        },
        {
          header: "Organization",
          cell: (subscriber) => subscriber.user.organization_name ?? "—",
        },
        {
          header: "Receives mail",
          // The word carries it: a reader who cannot separate the hues still
          // reads "Subscribed" or "Not subscribed".
          cell: (subscriber) => (
            <Badge tone={subscriber.subscribed ? "ok" : "neutral"}>
              {subscriber.subscribed ? "Subscribed" : "Not subscribed"}
            </Badge>
          ),
          width: "fit",
          sort: { asc: "subscribed", desc: "-subscribed" },
          filter: {
            param: "subscribed",
            options: [
              { value: "", label: "Everyone" },
              { value: "true", label: "Subscribed" },
              { value: "false", label: "Not subscribed" },
            ],
          },
        },
        { header: "Because", cell: standingReason },
      ]}
      rowKey={(subscriber) => subscriber.user.id}
      empty={
        <EmptyState
          title="Nobody is on this list yet"
          body="Members appear here once they are eligible for the list through this group or their membership category."
        />
      }
    />
  );
}
