/** The actual questionnaire controls, with synthetic field definitions. */
import { useState } from "preact/hooks";
import { Button } from "../Button";
import { formFieldOptionsSchema } from "../../../shared/schemas/form-field-rules";
import { CustomFieldList } from "../../shared/widgets/custom-fields";
import type { FormField } from "../../shared/types";
import "../../../scss/_event-flows.scss";

const fields: FormField[] = [
  {
    key: "dietary",
    label: "Dietary restrictions",
    fieldType: "multi_select",
    required: false,
    options: formFieldOptionsSchema.parse([
      "Vegetarian",
      "Vegan",
      "Halal",
      "Kosher",
      "gluten_free",
      "lactose_free",
      "nut_allergy",
      "Other",
    ]),
    optionSource: null,
    validation: {
      uiWidget: "checkboxes",
      helpText: "We will share this information with the venue to help accommodate your needs.",
    },
    sortOrder: 0,
  },
  {
    key: "interests",
    label: "Interests (topics)",
    fieldType: "multi_select",
    required: false,
    options: formFieldOptionsSchema.parse([
      "Algorithms",
      "Policy",
      "Implementation",
      "Certificate Management",
      "Zero Trust",
      "Compliance",
    ]),
    optionSource: null,
    validation: { allowCustom: true, placeholder: "Type a topic…" },
    sortOrder: 1,
  },
  {
    key: "experience",
    label: "Experience with PKI",
    fieldType: "number",
    required: false,
    options: null,
    optionSource: null,
    validation: { uiWidget: "rating_stars", min: 1, max: 5 },
    sortOrder: 2,
  },
];
export function RegistrationFieldsPreview() {
  const [restored, setRestored] = useState(false);
  return (
    <div class="pk-stack">
      <div data-gallery-open>
        <Button onClick={() => setRestored(true)}>Restore saved answers</Button>
      </div>
      <CustomFieldList
        fields={fields}
        context={{ dayAttendance: [] }}
        initialValues={
          restored ? { dietary: ["nut_allergy"], interests: ["Policy"], experience: 4 } : { dietary: ["nut_allergy"] }
        }
      />
    </div>
  );
}
