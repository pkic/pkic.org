import cbomIcon from "../../icons/wg/cbom.svg?raw";
import caIcon from "../../icons/wg/ca.svg?raw";
import cmIcon from "../../icons/wg/cm.svg?raw";
import pkimmIcon from "../../icons/wg/pkimm.svg?raw";
import pkimmAssessmentIcon from "../../icons/wg/pkimm-assessment.svg?raw";
import pkimmModelIcon from "../../icons/wg/pkimm-model.svg?raw";
import pqcIcon from "../../icons/wg/pqc.svg?raw";
import tcIcon from "../../icons/wg/tc.svg?raw";

/**
 * The working-group glyphs, inlined.
 *
 * Hugo's `wg/icon.html` read the file and substituted the caller's class into
 * an `ICON_CLASS` placeholder; the same substitution happens here so one SVG
 * serves the spotlight card, the mega menu and the page headers.
 */
const ICONS: Readonly<Record<string, string>> = {
  ca: caIcon,
  cbom: cbomIcon,
  cm: cmIcon,
  pkimm: pkimmIcon,
  "pkimm-assessment": pkimmAssessmentIcon,
  "pkimm-model": pkimmModelIcon,
  pqc: pqcIcon,
  tc: tcIcon,
  tcwg: tcIcon,
};

export function workingGroupIconMarkup(name?: string, className = "wg-icon"): string | undefined {
  const svg = name ? ICONS[name.toLowerCase()] : undefined;
  return svg?.replace(/class="ICON_CLASS"/, `class="${className}"`);
}

export function WorkingGroupIcon({ className, name }: { className?: string; name?: string }) {
  const svg = workingGroupIconMarkup(name, className ?? "wg-icon");
  if (!svg) return null;
  // The SVG is the slot's only child: the mega card and the spotlight card both
  // size the glyph directly, so the wrapper must not become a box of its own.
  // A class rather than an inline style, which the site's CSP refuses.
  return <span class="pk-wg-icon-slot" dangerouslySetInnerHTML={{ __html: svg }} />;
}
