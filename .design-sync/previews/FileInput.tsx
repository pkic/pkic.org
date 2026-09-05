import { Field, FileInput } from "pkic-org-events-backend";

/** Stands in for a stored member logo, so the preview fetches nothing. */
const LOGO_SPECIMEN =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'%3E%3Crect fill='%234c51bf' width='120' height='40' rx='6'/%3E%3Ctext x='60' y='25' fill='%23ffffff' font-family='sans-serif' font-size='14' text-anchor='middle'%3ESecureCA%3C/text%3E%3C/svg%3E";

export function Default() {
  return (
    <div class="pk pk-form">
      <Field label="Signed membership agreement" required help="PDF, up to 5 MB.">
        {(control) => <FileInput {...control} accept="application/pdf" />}
      </Field>

      <Field label="Working group charter" help="The draft the steering committee will review.">
        {(control) => (
          <FileInput {...control} buttonLabel="Upload charter" placeholder="No charter uploaded yet" />
        )}
      </Field>
    </div>
  );
}

export function WithPreview() {
  return (
    <div class="pk pk-form">
      <Field label="Organization logo" help="SVG or PNG. Replaces the current logo once the secretariat approves it.">
        {(control) => (
          <FileInput
            {...control}
            accept="image/svg+xml,image/png"
            buttonLabel="Replace logo"
            clearLabel="Remove"
            preview={<img src={LOGO_SPECIMEN} alt="SecureTrust CA logo currently on file" />}
          />
        )}
      </Field>
    </div>
  );
}

export function States() {
  return (
    <div class="pk pk-form">
      <Field label="Charter" state="invalid" message="Choose a charter document before submitting.">
        {(control) => <FileInput {...control} accept="application/pdf" />}
      </Field>

      <Field label="Countersigned agreement" state="ok" message="Received 11 February 2026.">
        {(control) => <FileInput {...control} placeholder="PKIC-MA-2023-0148-countersigned.pdf" />}
      </Field>

      <Field label="Board resolution" help="Locked until the membership application is approved.">
        {(control) => <FileInput {...control} disabled />}
      </Field>
    </div>
  );
}
