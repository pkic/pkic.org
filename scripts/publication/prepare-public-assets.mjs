import { constants } from "node:fs";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { sitePublicationReleaseSchema } from "../../assets/shared/schemas/site-publication-release.ts";

/** Keep a prior publication out of the next framework input, including withdrawn pages. */
export async function preparePublicationPublicAssets(source, output) {
  await mkdir(output, { recursive: true });
  try {
    await access(source);
  } catch (error) {
    if (error.code === "ENOENT") return output;
    throw error;
  }
  let previous;
  try {
    previous = await readFile(resolve(source, "publication.json"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const owned = new Set(previous ? sitePublicationReleaseSchema.parse(JSON.parse(previous)).files : []);
  await cp(source, output, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    filter(path) {
      const name = relative(source, path).split("\\").join("/");
      return !owned.has(name) && !["_astro", "_published", "pagefind", "publication.json"].includes(name.split("/")[0]);
    },
  });
  return output;
}
