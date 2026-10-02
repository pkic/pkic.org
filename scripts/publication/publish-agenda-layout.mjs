import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { agendaLayoutCss } from "../../assets/shared/agenda-layout-css.ts";

/** Publish schedule geometry before first paint, under the site's strict CSP. */
export async function publishAgendaLayout(document, output) {
  const css = agendaLayoutCss(
    [...document.querySelectorAll("[data-agenda-height]")].map((row) => Number(row.dataset.agendaHeight)),
  );
  if (!css) return null;
  const path = `_published/agenda/${createHash("sha256").update(css).digest("hex")}.css`;
  await mkdir(resolve(output, "_published", "agenda"), { recursive: true });
  await writeFile(resolve(output, path), css);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `/${path}`;
  link.dataset.agendaLayout = "";
  document.head.append(link);
  return path;
}
