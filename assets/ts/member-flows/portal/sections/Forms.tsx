import { useEffect } from "preact/hooks";
import { usePortalHashLocation } from "../hash-location";
import {
  FormManagementCreate,
  FormManagementDetail,
  FormManagementList,
} from "../../../components/forms/management/FormManagement";
import { toast } from "../ui";

/** Reserved form key that routes to the creation view instead of a form's detail. */
const NEW_FORM_KEY = "new";

function FormsRedirect({ to }: { to: string }) {
  const [, navigate] = usePortalHashLocation();
  useEffect(() => navigate(to), [navigate, to]);
  return null;
}

/** Portal route adapter for the canonical global form-management surface. */
export function Forms({ formKey, canWrite }: { formKey?: string; canWrite: boolean }) {
  const [, navigate] = usePortalHashLocation();
  const notify = (message: string, kind: "success" | "error") => toast(message, kind);

  if (formKey === NEW_FORM_KEY) {
    if (!canWrite) return <FormsRedirect to="/forms" />;
    return (
      <FormManagementCreate
        onCreated={(key) => navigate(`/forms/${encodeURIComponent(key)}`)}
        onCancel={() => navigate("/forms")}
        notify={notify}
      />
    );
  }

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
      onCreateNew={canWrite ? () => navigate(`/forms/${NEW_FORM_KEY}`) : undefined}
    />
  );
}
