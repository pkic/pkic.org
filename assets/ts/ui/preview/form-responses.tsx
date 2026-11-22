import type { PreviewSection } from "./PreviewShell";
import { FormSubmissionsTable } from "../../components/forms/FormResponseViews";
import { formSubmissionsResponseSchema } from "../../../shared/schemas/form-management";
import { formFieldDefinitionSchema } from "../../../shared/schemas/forms";

const field = formFieldDefinitionSchema.parse({
  id: "90000000-0000-4000-8000-000000000001",
  key: "dietary_restrictions",
  label: "Dietary restrictions",
  fieldType: "multi_select",
  required: false,
  options: [
    { value: "vegan", label: "Vegan" },
    { value: "nut_allergy", label: "Nut allergy" },
  ],
  optionSource: null,
  validation: null,
  sortOrder: 10,
  updatedAt: "2026-11-18T12:00:00.000Z",
  archivedAt: null,
});

function FormResponsesPreview() {
  return (
    <FormSubmissionsTable
      fields={[field]}
      endpoint="/preview/responses"
      exportEndpoint="/preview/exports"
      responseSchema={formSubmissionsResponseSchema}
      onOpen={() => {}}
      load={async (_url, _signal, schema) =>
        schema.parse({
          form: {
            id: "preview",
            key: "registration",
            title: "Registration",
            purpose: "event_registration",
            placement: null,
          },
          page: { limit: 50, offset: 0, total: 2, hasMore: false },
          submissions: [
            {
              id: "one",
              status: "registered",
              submittedAt: "2026-11-18T12:00:00.000Z",
              contextType: "registration",
              contextRef: "one",
              submitter: { id: "ada", firstName: "Ada", lastName: "Example", email: null, organization: null },
              answers: { dietary_restrictions: ["vegan", "nut_allergy"] },
            },
            {
              id: "two",
              status: "registered",
              submittedAt: "2026-11-18T12:00:00.000Z",
              contextType: "registration",
              contextRef: "two",
              submitter: { id: "sam", firstName: "Sam", lastName: "Example", email: null, organization: null },
              answers: { dietary_restrictions: ["vegan"] },
            },
          ],
        })
      }
    />
  );
}

export const formResponsesSection: PreviewSection = {
  id: "form-responses",
  title: "Form responses",
  note: "Sort answer columns, filter a dietary selection, and download names with that answer field.",
  render: () => <FormResponsesPreview />,
};
