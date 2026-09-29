/**
 * Mounts a Hugo template's static markup for a jsdom test.
 *
 * Hand-written fixtures drift from the templates they stand in for, and the
 * drift is invisible: the test keeps passing against markup the site no longer
 * ships. Reading the template itself means a class or a wrapper removed from
 * the page is removed from the test at the same moment.
 *
 * Only the static skeleton survives — Hugo actions are stripped, so a template
 * whose behaviour depends on rendered content is not a candidate for this.
 */
export function mountTemplate(source: string, parent: ParentNode = document.body): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = source.replace(/\{\{-?[\s\S]*?-?\}\}/g, "");
  parent.append(host);
  return host;
}
