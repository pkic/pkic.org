import {
  adminFormCreateResponseSchema,
  adminFormUpdateResponseSchema,
  type AdminFormDetailResponse,
} from "../../../../../shared/schemas/admin-forms";
import type { FormDefinitionCreateInput, FormDefinitionUpdateInput } from "../../../../../shared/schemas/forms";
import { FormDefinitionEditor } from "../../../../components/forms/FormDefinitionEditor";
import { api } from "../../../api";
import { toast } from "../../../ui";

export type AdminFormDetail = AdminFormDetailResponse;

export function FormEditor({
  mode,
  detail,
  slug,
  onSaved,
  onCancel,
}: {
  mode: "create" | "edit";
  detail: AdminFormDetail | null;
  slug?: string;
  onSaved: (key: string) => void;
  onCancel: () => void;
}) {
  async function save(payload: FormDefinitionCreateInput | FormDefinitionUpdateInput): Promise<string> {
    if (mode === "create") {
      const input = payload as FormDefinitionCreateInput;
      const endpoint = slug ? `/api/v1/admin/events/${slug}/forms` : "/api/v1/admin/forms";
      const response = await api(endpoint, adminFormCreateResponseSchema, {
        method: "POST",
        body: JSON.stringify(input),
      });
      toast(slug ? "Form created" : "Global form created", "success");
      return response.key;
    }

    if (!detail) throw new Error("The form definition is unavailable.");
    await api(`/api/v1/admin/forms/${encodeURIComponent(detail.form.key)}`, adminFormUpdateResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(payload as FormDefinitionUpdateInput),
    });
    toast("Form updated", "success");
    return detail.form.key;
  }

  return (
    <FormDefinitionEditor
      mode={mode}
      detail={detail}
      onSave={save}
      onSaved={onSaved}
      onCancel={onCancel}
      onError={(message) => toast(message, "error")}
    />
  );
}
