import {
  badgeTemplateAssetBytes,
  badgeTemplateCss,
  parseBadgeTemplateMarkup,
  type BadgeTemplateNode,
} from "./badge-template-policy";
import {
  badgeSponsorGroupSource,
  badgeTemplateBrandingSchema,
  eventBadgeTemplateSchema,
  type EventBadgeTemplate,
  type BadgeTemplateSponsorGroup,
} from "./schemas/event-badge-template";
import { badgeDisplayRoleSchema, type BadgeDisplayRole } from "./schemas/participant-roles";
import { splitBadgePrintSvg } from "./badge-print-svg";
import { badgeTextFitProperties } from "./badge-template-text-fit";

export const BADGE_PRINT_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export interface BadgeTemplatePrintData {
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  organization?: string | null;
  jobTitle?: string | null;
  badgeRole: BadgeDisplayRole;
  /** Only the existing owned badge QR composition may supply this field. */
  svg: string;
}
export type { BadgeTemplateSponsorGroup } from "./schemas/event-badge-template";
export const BADGE_DISPLAY_ROLE_COLORS: Readonly<Record<BadgeDisplayRole, string>> = {
  attendee: "#0b0d0c",
  speaker: "#ed7d31",
  staff: "#198754",
  sponsor: "#5a9bd5",
};
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}
function svgImage(svg: string, label: string, className: string): string {
  return `<img class="${className}" alt="${escape(label)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
}

interface VectorResource {
  id: string;
  viewBox: string;
  aspect: number;
}

/** Compile artwork once per print document; render attendee text separately for every physical slot. */
export function compileBadgeTemplate(input: EventBadgeTemplate, branding: readonly BadgeTemplateSponsorGroup[] = []) {
  const template = eventBadgeTemplateSchema.parse(input);
  const checkedBranding = badgeTemplateBrandingSchema.parse(branding);
  const definitions: string[] = [];
  const vectors = new Map<string, VectorResource>();
  function vector(svg: string) {
    const previous = vectors.get(svg);
    if (previous) return previous;
    const id = `badge-vector-${vectors.size}`;
    const root = /^\s*<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
    const attribute = (key: string) => new RegExp(`\\b${key}=["']([^"']+)["']`, "i").exec(root)?.[1];
    const viewBox =
      attribute("viewBox") ??
      `0 0 ${parseFloat(attribute("width") ?? "300")} ${parseFloat(attribute("height") ?? "150")}`;
    const dimensions = viewBox.trim().split(/[ ,]+/).map(Number);
    if (
      dimensions.length !== 4 ||
      dimensions.some((value) => !Number.isFinite(value)) ||
      dimensions[2] <= 0 ||
      dimensions[3] <= 0
    )
      throw new Error("Vector artwork needs a valid viewBox or dimensions.");
    let owned = svg.replace(/^\s*<svg\b[^>]*>/i, (opening) =>
      opening.replace(/\s(?:width|height)=["'][^"']*["']/g, ""),
    );
    const ids = [...owned.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
    for (const original of ids) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_.:-]*$/.test(original))
        throw new Error("Vector artwork has an unsupported internal identifier.");
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      owned = owned
        .replace(new RegExp(`(\\bid=["'])${escaped}(["'])`, "g"), `$1${id}-${original}$2`)
        .replace(new RegExp(`(url\\(\\s*["']?#)${escaped}(["']?\\s*\\))`, "g"), `$1${id}-${original}$2`);
    }
    // The artwork keeps its own viewBox inside; the symbol and every use place it from a zero origin.
    const resource = { id, viewBox: `0 0 ${dimensions[2]} ${dimensions[3]}`, aspect: dimensions[2] / dimensions[3] };
    definitions.push(`<symbol id="${id}" viewBox="${resource.viewBox}">${owned}</symbol>`);
    vectors.set(svg, resource);
    return resource;
  }
  const artwork = new Map(
    Object.entries(template.assets)
      .filter(([, asset]) => asset.mime === "image/svg+xml")
      .map(([key, asset]) => [key, vector(new TextDecoder().decode(badgeTemplateAssetBytes(asset.base64)))]),
  );
  const sponsorResources = new Map(
    checkedBranding.flatMap((group) => group.sponsors.map((sponsor) => [sponsor.svg, vector(sponsor.svg)] as const)),
  );
  /** Sponsor logos expose their aspect ratio so a template can balance logos of different shapes optically. */
  function vectorImage(resource: VectorResource, label: string, className: string, exposeAspect = false): string {
    const aspect = exposeAspect ? ` style="--badge-logo-aspect:${Math.round(resource.aspect * 1000) / 1000}"` : "";
    return `<svg class="${escape(className)}" role="img" aria-label="${escape(label)}" viewBox="${resource.viewBox}" preserveAspectRatio="xMidYMid meet"${aspect}><use href="#${resource.id}"></use></svg>`;
  }
  const urls = new Map(
    Object.entries(template.assets).map(([key, asset]) => [key, `data:${asset.mime};base64,${asset.base64}`]),
  );
  const groups = new Set(template.sponsorGroups.map((group) => group.key));
  const front = parseBadgeTemplateMarkup(template.frontHtml, new Set(urls.keys()), groups);
  const back = parseBadgeTemplateMarkup(template.backHtml, new Set(urls.keys()), groups);
  const css =
    badgeTemplateCss(template.css, urls) +
    "\n.badge-template-qr{display:block;width:100%;height:100%;object-fit:contain}.badge-template-sponsors{display:flex;flex-direction:column;align-items:center;gap:2mm}.badge-template-sponsor-logos{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:3mm}.badge-template-sponsor-logo{max-width:35mm;max-height:12mm;object-fit:contain}.badge-template-role{background:var(--badge-role-color);color:var(--badge-role-text);text-align:center;font-weight:bold}";
  return {
    css,
    resourcesHtml: `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden"><defs>${definitions.join("")}</defs></svg>`,
    renderSide(side: "front" | "back", badge: BadgeTemplatePrintData): string {
      const role = badgeDisplayRoleSchema.parse(badge.badgeRole);
      const split = splitBadgePrintSvg(badge.svg);
      const values: Record<string, string> = {
        displayName: badge.displayName,
        firstName: badge.firstName ?? "",
        lastName: badge.lastName ?? "",
        organization: badge.organization ?? "",
        jobTitle: badge.jobTitle ?? "",
        badgeRole: role.toUpperCase(),
        badgeCode: split?.code ?? "",
      };
      // Numeric measurements only: attendee text itself never enters the style attribute.
      const textFit = badgeTextFitProperties({
        firstName: values.firstName,
        lastName: values.lastName,
        displayName: values.displayName,
        organization: values.organization,
        jobTitle: values.jobTitle,
      });
      const render = (nodes: readonly (BadgeTemplateNode | string)[]): string =>
        nodes
          .map((node) => {
            if (typeof node === "string") {
              if (node.trim() === "{{qr}}") return svgImage(badge.svg, "Attendee badge QR code", "badge-template-qr");
              if (node.trim() === "{{qrImage}}")
                return svgImage(split?.qr ?? badge.svg, "Attendee badge QR code", "badge-template-qr");
              if (node.trim().startsWith("{{sponsors:")) {
                const key = node.trim().slice(11, -2);
                const definition = template.sponsorGroups.find((group) => group.key === key);
                const group = checkedBranding.find(
                  (item) =>
                    definition &&
                    item.key === key &&
                    item.tierName === definition.tierName &&
                    badgeSponsorGroupSource(item) === badgeSponsorGroupSource(definition),
                );
                if (!group?.sponsors.length) return "";
                return `<section class="badge-template-sponsors"><span class="badge-template-sponsor-tier">${escape(definition?.label ?? group.tierName)}</span><div class="badge-template-sponsor-logos">${group.sponsors.map((sponsor) => vectorImage(sponsorResources.get(sponsor.svg)!, sponsor.name, "badge-template-sponsor-logo", true)).join("")}</div></section>`;
              }
              return node
                .split(/({{[^{}]*}})/g)
                .map((part) => escape(part.startsWith("{{") ? (values[part.slice(2, -2)] ?? "") : part))
                .join("");
            }
            if (node.tag === "img") {
              const resource = artwork.get(node.attributes.src.slice(6));
              if (!resource) throw new Error("Template images must reference vector artwork.");
              return vectorImage(resource, node.attributes.alt ?? "", node.attributes.class ?? "");
            }
            const attrs = Object.entries(node.attributes)
              .map(([key, value]) => ` ${key}="${escape(key === "src" ? urls.get(value.slice(6))! : value)}"`)
              .join("");
            return `<${node.tag}${attrs}>${render(node.children)}${["img", "br"].includes(node.tag) ? "" : `</${node.tag}>`}`;
          })
          .join("");
      const textColor = role === "attendee" || role === "staff" ? "#fff" : "#0b0d0c";
      return `<div class="badge-template" style="--badge-role-color:${BADGE_DISPLAY_ROLE_COLORS[role]};--badge-role-text:${textColor};${textFit};width:${template.widthMm}mm;height:${template.heightMm}mm;position:relative;overflow:hidden">${render(side === "front" ? front : back)}</div>`;
    },
  };
}
