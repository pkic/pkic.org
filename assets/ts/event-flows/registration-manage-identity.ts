/** Show confirmed event attribution once, without exposing account profile edits. */
export function applyConfirmedRegistrationIdentity(
  form: HTMLFormElement,
  user: { organization_name: string | null; job_title: string | null } | null,
): void {
  const identityNote = form.querySelector<HTMLElement>("[data-registration-identity-note]");
  if (identityNote) identityNote.hidden = false;
  for (const [name, customName] of [
    ["organizationName", "custom.organization_name"],
    ["jobTitle", "custom.job_title"],
  ]) {
    if (form.elements.namedItem(customName)) {
      const control = form.elements.namedItem(name);
      if (control instanceof HTMLInputElement) {
        const field = control.closest<HTMLElement>(".pk-field");
        if (field) field.hidden = true;
        control.disabled = true;
      }
    }
  }
  for (const [name, value] of Object.entries({
    organizationName: user?.organization_name,
    jobTitle: user?.job_title,
    "custom.organization_name": user?.organization_name,
    "custom.job_title": user?.job_title,
  })) {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLInputElement) {
      control.value = value ?? "";
      control.readOnly = true;
      control.title = "Identity details confirmed for this event.";
    }
  }
}
