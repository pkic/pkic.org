import { readdir, readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import ICAL from "ical.js";
import { conferenceProgramSchema } from "../../assets/shared/schemas/conference-program.ts";

/** Astro endpoint outputs must belong to the release, so assembly and withdrawal include them. */
export async function collectConferenceOutputs(output) {
  const directory = resolve(output, "events");
  let entries;
  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !["event-data.json", "agenda.ics"].includes(entry.name)) continue;
    const path = resolve(entry.parentPath, entry.name);
    const source = await readFile(path, "utf8");
    if (entry.name === "event-data.json") conferenceProgramSchema.parse(JSON.parse(source));
    else if (new ICAL.Component(ICAL.parse(source)).name !== "vcalendar")
      throw new Error(`Conference calendar is invalid: ${path}`);
    files.push(relative(output, path).split("\\").join("/"));
  }
  return files.sort();
}

/** Keep bookmarked legacy display URLs pointed at their native pages. */
export function conferenceDisplayRedirects(files) {
  return files
    .filter((file) => /^events\/.*\/event-(?:session|overlays|speakers2?)\/index\.html$/.test(file))
    .map((file) => ({
      from: `/${file.replace(/\/index\.html$/, ".html")}`,
      to: `/${file.replace(/index\.html$/, "")}`,
      status: 301,
    }));
}
