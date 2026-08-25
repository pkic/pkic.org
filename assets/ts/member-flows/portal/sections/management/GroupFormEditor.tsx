import {
  groupFormDefinitionCreateSchema,
  groupFormDefinitionMutationResponseSchema,
  groupFormDefinitionUpdateSchema,
  type GroupFormDefinitionCreateInput,
  type GroupFormDefinitionUpdateInput,
} from "../../../../../shared/schemas/group-forms";
import type { FormDefinitionCreateInput, FormDefinitionUpdateInput } from "../../../../../shared/schemas/forms";
import { FormDefinitionEditor, type EditableFormDetail } from "../../../../components/forms/FormDefinitionEditor";
import { patchJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";

export function GroupFormEditor({
  groupId,
  placementId,
  detail,
  onSaved,
  onCancel,
}: {
  groupId: string;
  placementId?: string;
  detail: EditableFormDetail | null;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const mode = placementId ? "edit" : "create";
  const groupBase = `/api/v1/groups/${encodeURIComponent(groupId)}/forms`;

  async function save(payload: FormDefinitionCreateInput | FormDefinitionUpdateInput): Promise<string> {
    if (mode === "create") {
      const input: GroupFormDefinitionCreateInput = groupFormDefinitionCreateSchema.parse(payload);
      const response = await postJson(groupBase, input, groupFormDefinitionMutationResponseSchema);
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
      purposes={["survey", "feedback"]}
      onSave={save}
      onSaved={() => void onSaved()}
      onCancel={onCancel}
      onError={(message) => toast(message, "error")}
    />
  );
}
