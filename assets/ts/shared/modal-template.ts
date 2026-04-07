export function mountModalTemplate(
  templateId: string,
  modalId: string,
  errorLabel: string,
): HTMLElement | null {
  const existing = document.getElementById(modalId);
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const template = document.getElementById(templateId);
  if (!(template instanceof HTMLTemplateElement)) {
    console.error(`${errorLabel} template not found`);
    return null;
  }

  document.body.appendChild(template.content.cloneNode(true));

  const modal = document.getElementById(modalId);
  if (!(modal instanceof HTMLElement)) {
    console.error(`${errorLabel} template did not render a modal root`);
    return null;
  }

  return modal;
}