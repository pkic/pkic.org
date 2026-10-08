import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** An explicit test root overrides the platform temporary directory. */
export async function createTemporaryDirectory(name: string, explicitPrefix?: string): Promise<string> {
  if (explicitPrefix) return mkdtemp(explicitPrefix);
  return mkdtemp(join(process.env.PKIC_TEST_TEMP_ROOT ?? tmpdir(), `${name}-`));
}
