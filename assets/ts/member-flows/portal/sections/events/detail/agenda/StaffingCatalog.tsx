import { Checkbox } from "../../../../../../ui/Checkbox";
import { useState } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaStaffingSchema } from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useStaffingSave } from "./useStaffingSave";

/** Event roles and physical posts are independent of access permissions. */
export function StaffingCatalog({
  snapshot,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  onSaved: (next: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState(snapshot.staffingRoles);
  const [posts, setPosts] = useState(snapshot.staffingPosts);
  const form = useContractForm(agendaStaffingSchema, {
    expectedRevision: snapshot.revision,
    shifts: snapshot.shifts,
    roleMembers: snapshot.roleMembers,
    assignments: snapshot.assignments,
    staffingRoles: roles,
    staffingPosts: posts,
    staffingRequirements: snapshot.staffingRequirements,
    staffingPositions: snapshot.staffingPositions,
  });
  const { busy, error, save } = useStaffingSave(snapshot.eventSlug, form, onSaved, onClose);
  return (
    <Panel>
      <PanelHeader title="Event roles and posts" />
      <PanelBody>
        <p>
          Define duties such as MC or Q&amp;A and physical posts such as a room door. Assigning a duty does not grant
          scanner or registration permissions. Roles stay private unless you choose to show their credited people on the
          public agenda.
        </p>
        {error && <ErrorAlert error={error} />}
        <form noValidate {...form.handlers} onSubmit={(event) => void save(event)} class="pk-stack">
          {roles.map((role, index) => (
            <div class="pk-stack" key={role.id}>
              <Field label="Role name" {...form.of(`staffingRoles.${index}.name`)}>
                {(control) => (
                  <TextInput
                    {...control}
                    name={`staffingRoles.${index}.name`}
                    value={role.name}
                    onInput={(event) =>
                      setRoles(
                        roles.map((row) => (row.id === role.id ? { ...row, name: event.currentTarget.value } : row)),
                      )
                    }
                  />
                )}
              </Field>
              <Field label="Agenda visibility" {...form.of(`staffingRoles.${index}.showOnAgenda`)} group>
                {(control) => (
                  <Checkbox
                    {...control}
                    name={`staffingRoles.${index}.showOnAgenda`}
                    label="Show this role on the public agenda"
                    checked={role.showOnAgenda}
                    onChange={(event) =>
                      setRoles(
                        roles.map((row) =>
                          row.id === role.id ? { ...row, showOnAgenda: event.currentTarget.checked } : row,
                        ),
                      )
                    }
                  />
                )}
              </Field>
            </div>
          ))}
          <Button
            type="button"
            onClick={() => setRoles([...roles, { id: crypto.randomUUID(), name: "", showOnAgenda: false }])}
          >
            Add role
          </Button>
          {posts.map((post, index) => (
            <div class="pk-grid" key={post.id}>
              <Field label="Post name" {...form.of(`staffingPosts.${index}.name`)}>
                {(control) => (
                  <TextInput
                    {...control}
                    name={`staffingPosts.${index}.name`}
                    value={post.name}
                    onInput={(event) =>
                      setPosts(
                        posts.map((row) => (row.id === post.id ? { ...row, name: event.currentTarget.value } : row)),
                      )
                    }
                  />
                )}
              </Field>
              <Field label="Post location" {...form.of(`staffingPosts.${index}.roomId`)}>
                {(control) => (
                  <Select
                    {...control}
                    name={`staffingPosts.${index}.roomId`}
                    value={post.roomId ?? ""}
                    onChange={(event) =>
                      setPosts(
                        posts.map((row) =>
                          row.id === post.id ? { ...row, roomId: event.currentTarget.value || null } : row,
                        ),
                      )
                    }
                  >
                    <option value="">Whole event</option>
                    {snapshot.rooms.map((room) => (
                      <option value={room.id}>{room.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          ))}
          <Button
            type="button"
            onClick={() => setPosts([...posts, { id: crypto.randomUUID(), name: "", roomId: null }])}
          >
            Add physical post
          </Button>
          <div class="pk-cluster pk-cluster--end">
            <Button disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} variant="primary">
              Save roles and posts
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
