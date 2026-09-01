import { useRef } from "preact/hooks";
import {
  groupFormDefinitionCreateSchema,
  groupFormDefinitionMutationResponseSchema,
  groupFormDefinitionUpdateSchema,
  type GroupFormDefinitionCreateInput,
  type GroupFormDefinitionUpdateInput,
} from "../../../../../shared/schemas/group-forms";
import type {
  FormDefinitionCreateInput,
  FormDefinitionUpdateInput,
  FormPurpose,
} from "../../../../../shared/schemas/forms";
import { FormDefinitionEditor, type EditableFormDetail } from "../../../../components/forms/FormDefinitionEditor";
import { patchJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";

export function GroupFormEditor({
  groupId,
  placementId,
  detail,
  purposes = ["survey", "feedback"],
  onSaved,
  onCancel,
}: {
  groupId: string;
  placementId?: string;
  detail: EditableFormDetail | null;
  purposes?: readonly FormPurpose[];
  /** Receives the created placement's id, so a create page can go to the record it just made. */
  onSaved: (createdPlacementId?: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const mode = placementId ? "edit" : "create";
  const groupBase = `/api/v1/groups/${encodeURIComponent(groupId)}/forms`;
  // The shared editor hands `onSaved` the form key, which does not address a
  // placement. The created placement id is carried between the two callbacks
  // here rather than widening that contract for every other caller.
  const createdPlacementId = useRef<string | undefined>(undefined);

  async function save(payload: FormDefinitionCreateInput | FormDefinitionUpdateInput): Promise<string> {
    if (mode === "create") {
      const input: GroupFormDefinitionCreateInput = groupFormDefinitionCreateSchema.parse(payload);
      const response = await postJson(groupBase, input, groupFormDefinitionMutationResponseSchema);
      createdPlacementId.current = response.placement.id;
      toast("Form created", "success");
      return response.form.key;
    }

    if (!placementId || !detail) throw new Error("The owned form definition is unavailable.");
    const input: GroupFormDefinitionUpdateInput = groupFormDefinitionUpdateSchema.parse(payload);
    const response = await patchJson(
      `${groupBase}/${encodeURIComponent(placementId)}/definition`,
      input,
      groupFormDefinitionMutationResponseSchema,
    );
    toast("Form updated", "success");
    return response.form.key;
  }

  return (
    <FormDefinitionEditor
      mode={mode}
      detail={detail}
      purposes={purposes}
      onSave={save}
      onSaved={() => void onSaved(createdPlacementId.current)}
      onCancel={onCancel}
      onError={(message) => toast(message, "error")}
    />
  );
}
