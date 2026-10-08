import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Private isolated-state key material, retained across local Worker restarts. */
export function localBadgePrintKeyring(state) {
  const file = path.join(state, ".badge-print-keyring.json");
  try {
    return readFileSync(file, "utf8").trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const value = JSON.stringify({ activeKeyId: "local", keys: { local: randomBytes(32).toString("hex") } });
  try {
    writeFileSync(file, `${value}\n`, { flag: "wx", mode: 0o600 });
    return value;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return readFileSync(file, "utf8").trim();
  }
}

/** Generated key IDs and hex material contain no single quotes or newlines. */
export function localBadgePrintEnvValue(keyring) {
  if (/[\r\n']/.test(keyring)) throw new Error("Invalid local badge keyring environment value");
  return `'${keyring}'`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [state, envFile] = process.argv.slice(2);
  if (!state || !envFile) throw new Error("Local badge printing requires an isolated state and env file");
  appendFileSync(envFile, `BADGE_PRINT_ENCRYPTION_KEYS=${localBadgePrintEnvValue(localBadgePrintKeyring(state))}\n`, {
    mode: 0o600,
  });
}
