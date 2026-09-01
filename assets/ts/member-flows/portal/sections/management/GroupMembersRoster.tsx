import { useState } from "preact/hooks";
import { groupMembershipsParticipantListResponseSchema } from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { PersonCell } from "../../../../components/PersonCell";
import { Spinner } from "../../../../components/Spinner";
import { useApiPage } from "../../../../hooks/useApiPage";
import { Button } from "../../../../ui/Button";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";

/**
 * Read-only roster shown to a participant who cannot manage the group: who
 * else is here, and which organization they represent, if any. The backend
 * projection never includes email addresses or membership-capacity
 * identifiers, so there is nothing here to redact — no row menu, no add
 * action, no management column.
 */
export function GroupMembersRoster({ groupId }: { groupId: string }) {
  const [pendingSearch, setPendingSearch] = useState("");
  const [search, setSearch] = useState("");
  const page = useApiPage(
    `/api/v1/groups/${encodeURIComponent(groupId)}/memberships`,
    { sort: "user_name", ...(search ? { q: search } : {}) },
    groupMembershipsParticipantListResponseSchema,
    (data) => data.memberships,
    25,
  );

  if (!page.data && page.loading) return <Spinner label="Loading group members…" />;

  return (
    // The panel names itself: a group workspace stacks several of these, and
    // an unnamed <section> is announced as nothing at all. Its body's `gap`
    // is what separates the search, the roster and the pager — each of those
    // carried its own margin before.
    <div class="pk">
      <Panel aria-label="Members">
        <PanelHeader title="Members" />
        <PanelBody class="pk-stack">
          {/* The search runs on submit rather than on every keystroke, so the
              field and its button are stacked rather than clustered: the label
              sits above the control, which no cluster can align a button to
              without guessing at the label's height. The name used to be
              visually hidden, which is a name a sighted reader cannot use
              either. */}
          <form
            class="pk-stack pk-stack--snug"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(pendingSearch.trim());
            }}
          >
            <Field label="Search members" help="Matches a member's name or the organization they represent.">
              {(control) => (
                <TextInput
                  {...control}
                  type="search"
                  placeholder="Search name or organization…"
                  value={pendingSearch}
                  onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
                />
              )}
            </Field>
            <div class="pk-cluster">
              <Button type="submit" size="sm">
                Search
              </Button>
            </div>
          </form>
          {/* A failed load replaces the roster rather than sitting above an
              empty one: "No matching members" is a claim about the group, and
              the surface does not know that when the request did not arrive. */}
          {page.error ? (
            <ErrorAlert error={page.error.message} />
          ) : page.data && page.data.memberships.length === 0 ? (
            <EmptyState title="No matching members." body="Nobody in this group matches this search." />
          ) : (
            /* A list, and announced as one, but not a `<ul>`: the base layer
               restores the marker and the 1.2rem indent that Bootstrap's
               `list-unstyled` used to remove, and a bullet beside a person's
               face is not what this is. The roles keep the semantics — "list,
               12 items" — without a stylesheet reset that only this surface
               would need. */
            <div class="pk-stack" role="list">
              {page.data?.memberships.map((participant, index) => (
                <div key={`${participant.userId}-${index}`} role="listitem">
                  <PersonCell
                    firstName={participant.name}
                    lastName={null}
                    email={null}
                    headshotUrl={participant.headshotUrl}
                    secondary={participant.organizationName}
                  />
                </div>
              ))}
            </div>
          )}
          {page.pagerProps && <Pager {...page.pagerProps} />}
        </PanelBody>
      </Panel>
    </div>
  );
}
