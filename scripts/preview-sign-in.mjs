/**
 * Signs a persona account in to a preview (or the local Worker) with its seeded
 * software passkey and prints the session cookie. It refuses any other host, so
 * it can never open a production session.
 *
 * Usage: pnpm preview:sign-in --passkeys <file> --email <persona address> [--base <url>]
 */
import { readPasskey, signInWithPasskey, testOrigin } from "./lib/preview-scale/passkeys.mjs";

const USAGE = "Usage: pnpm preview:sign-in --passkeys <file> --email <persona address> [--base <url>]";

function parseArgs(argv) {
  const options = { base: "https://stable.preview.pkic.org" };
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (!value) throw new Error(USAGE);
    if (flag === "--passkeys") options.passkeys = value;
    else if (flag === "--email") options.email = value;
    else if (flag === "--base") options.base = value;
    else throw new Error(USAGE);
  }
  if (!options.passkeys || !options.email) throw new Error(USAGE);
  return { ...options, origin: testOrigin(options.base) };
}

try {
  const options = parseArgs(process.argv.slice(2));
  console.log(await signInWithPasskey(readPasskey(options.passkeys, options.email), options.origin));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
