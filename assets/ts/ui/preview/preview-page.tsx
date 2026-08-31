/**
 * Entry point for the design-system preview at /design/.
 *
 * Self-executing, following the loader convention: importing the module is
 * enough to mount it. The page is unlisted and noindex — it exists to see and
 * tune the primitives, and to check each surface as it comes off Bootstrap.
 */

import { render } from "preact";

import { PreviewShell } from "./PreviewShell";
import { basicSections } from "./sections-basics";
import { dataSections } from "./sections-data";

function main(): void {
  const mount = document.getElementById("pk-preview");
  if (!mount) return;
  render(<PreviewShell sections={[...basicSections, ...dataSections]} />, mount);
}

main();
