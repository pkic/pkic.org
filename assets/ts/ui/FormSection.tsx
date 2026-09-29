/**
 * A named group of fields inside a form.
 *
 * Every form here hand-rolled it as a legend wearing the field label's own
 * class, which gave a section heading a field label's typography — so "Web presence"
 * and the "Website" label beneath it were the same thing twice, and read as two
 * labels for one input. That is what issue #53 calls a double title, and it was
 * in thirty-one places.
 *
 * A section heading has to outrank a field label to do its job, so it is set in
 * the small caps the rest of the portal uses for a kicker: same size, wider
 * tracking, muted, and separated from what came before. The eye reads it as
 * "here begins a group", never as "here is a field".
 *
 * A section with a single field whose label repeats the heading is a heading
 * that should not exist; group two or more, or drop it and let the field speak.
 *
 * Not every `<legend>` is one of these. A legend naming a set of radios, a set
 * of checkboxes, or one composite widget is that group's *label* — the thing a
 * reader answers — and correctly keeps the field label's typography. "Role"
 * over three radios is a label; "Details" over four unrelated fields is a
 * section. The difference is whether the words name one answer or open a
 * group of questions.
 */
import type { ComponentChildren } from "preact";
import "./FormSection.css";

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  /** One line on what the group is for, where the fields cannot say it alone. */
  description?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <fieldset class="pk-form-section">
      <legend class="pk-form-section__title">{title}</legend>
      {description && <p class="pk-form-section__description">{description}</p>}
      <div class="pk-form-section__fields">{children}</div>
    </fieldset>
  );
}
