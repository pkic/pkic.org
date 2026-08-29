import { useHashLocation } from "wouter/use-hash-location";
import { FormManagementDetail, FormManagementList } from "../../../components/forms/management/FormManagement";
import { toast } from "../ui";

/** Portal route adapter for the canonical global form-management surface. */
export function Forms({ formKey, canWrite }: { formKey?: string; canWrite: boolean }) {
  const [, navigate] = useHashLocation();
  const notify = (message: string, kind: "success" | "error") => toast(message, kind);

  if (formKey) {
    return (
      <FormManagementDetail
        formKey={formKey}
        canWrite={canWrite}
        onBack={() => navigate("/forms")}
        onChanged={() => navigate("/forms")}
        notify={notify}
      />
    );
  }

  return (
    <FormManagementList
      canWrite={canWrite}
      onOpenForm={(key) => navigate(`/forms/${encodeURIComponent(key)}`)}
      notify={notify}
    />
  );
}
