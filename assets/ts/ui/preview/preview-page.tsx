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
import { densitySections } from "./sections-density";
import { overlaySections } from "./sections-overlays";
import { patternSections } from "./sections-patterns";

function main(): void {
  const mount = document.getElementById("pk-preview");
  if (!mount) return;
  const sections = [...basicSections, ...dataSections, ...densitySections, ...overlaySections, ...patternSections];
  // `?only=<id>` renders one section alone, for a tight screenshot of one control.
  const only = new URLSearchParams(window.location.search).get("only");
  const shown = only ? sections.filter((section) => section.id === only) : sections;
  render(<PreviewShell sections={shown} />, mount);
}

main();
