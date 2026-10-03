import { resolve } from "node:path";

export function publicationEnvironment() {
  const branch = process.env.WORKERS_CI_BRANCH;
  const environment =
    process.env.CLOUDFLARE_ENV ?? (branch ? (branch.toLowerCase() === "main" ? "production" : "preview") : "local");
  if (!["local", "preview", "production"].includes(environment)) throw new Error("Invalid publication environment");
  return environment;
}

export function publicationStagingDirectory() {
  const id = process.env.PKIC_PUBLICATION_BUILD_ID;
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Publication requires an isolated build identifier");
  return resolve(".cache", "publication", publicationEnvironment(), id);
}
