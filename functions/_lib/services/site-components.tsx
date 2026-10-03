import { SiteImage, prepareSiteImage } from "../../../assets/ts/site/SiteImage";
import { DonationForm } from "../../../assets/ts/site/DonationForm";
import { ApplicationStatusView } from "../../../assets/ts/site/ApplicationStatusView";
import { EventRegistrationConfirmation } from "../../../assets/ts/site/EventRegistrationConfirmation";
import { EventRegistrationManagement } from "../../../assets/ts/site/EventRegistrationManagement";
import { EventRegistrationForm } from "../../../assets/ts/site/EventRegistrationForm";
import { SponsorshipInquiryForm } from "../../../assets/ts/site/SponsorshipInquiryForm";
import { InvitationDeclineForm } from "../../../assets/ts/site/InvitationDeclineForm";
import { EventProposalForm } from "../../../assets/ts/site/EventProposalForm";
import { EventProposalManagement } from "../../../assets/ts/site/EventProposalManagement";
import { EventSpeakerManagement } from "../../../assets/ts/site/EventSpeakerManagement";
import { EventSpeakerPresentation } from "../../../assets/ts/site/EventSpeakerPresentation";
import { renderContentAgenda } from "./site-agenda";
import { buttonVariant, renderContentCards } from "./site-content-cards";
import { renderToStringAsync as render } from "preact-render-to-string";
import { renderSiteMarkdown } from "./site-markdown-processor";
import {
  SHORTCODE_BLOCK,
  SHORTCODE_LEAF,
  normalizeDirectives,
  objectValue,
  parseArguments,
  type ContentCall,
} from "./site-shortcodes";
import trustListPublishers from "virtual:pkic-trust-list";
import { TrustLists } from "../../../assets/ts/site/TrustLists";
import { JoinFlow, type MembershipDocument } from "../../../assets/ts/site/JoinFlow";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { GroupGovernanceView } from "../../../assets/ts/site/GroupGovernance";
import { DirectoryGrid } from "../../../assets/ts/site/MemberDirectory";
import { MemberWallView, SponsorGridView, SponsorLevelView } from "../../../assets/ts/site/SponsorDisplays";
import { sponsorPublicationKey } from "../../../assets/shared/sponsor-publication-query";
import {
  ContentAlert,
  ContentMemberWall,
  ContentBanner,
  ContentButtonLink,
  ContentFaq,
  ContentFigure,
  ContentFrame,
  ContentGallery,
  ContentGlossary,
  ContentHtml,
  ContentRow,
  ContentColumn,
  ContentIsland,
  ContentMaturity,
  ContentStats,
  ContentVideo,
} from "../../../assets/ts/site/ContentComponents";
import { SiteListingSection } from "../../../assets/ts/site/SitePrimitives";
import type { SiteListing } from "../../../assets/shared/site-content";
import { normalizeSitePath, type FrontMatter } from "./site-markdown";

export type ContentCollectionKind = "events" | "recent-posts" | "working-groups";

export interface ContentComponentContext {
  assetUrl: (assetName?: string) => string | undefined;
  assetUrls: (pattern?: string) => string[];
  data: FrontMatter;
  eventData?: Record<string, unknown>;
  /** Assets owned by the page that declares the inherited event data. */
  eventAssetUrls?: (pattern?: string) => string[];
  listing: (kind: ContentCollectionKind, limit?: number) => SiteListing;
  membershipDocuments?: () => Promise<MembershipDocument[]>;
  publication?: SitePublicationSnapshot;
  route: string;
  sourcePath: string;
}

interface RenderedCall {
  block: boolean;
  html: string;
}

type ContentRenderer = (call: ContentCall, context: ContentComponentContext) => Promise<RenderedCall>;

/** One line of Markdown as inline HTML, the way Hugo's `markdownify` renders it. */
export async function inlineMarkdownHtml(value: string): Promise<string> {
  return (await renderSiteMarkdown(value)).replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1");
}

async function markdownHtml(value: unknown): Promise<string> {
  return value == null ? "" : await renderSiteMarkdown(String(value));
}

function component(html: string, block = true): RenderedCall {
  return { block, html };
}

/** The member/sponsor logo wall island, with the caller's cap on member logos. */
const memberWall: ContentRenderer = async (call, context) => {
  if (context.publication)
    return component(
      await render(
        <div class="members" data-published-member-wall>
          <MemberWallView entries={context.publication.memberWall.slice(0, Number(call.props.limit ?? 200))} />
        </div>,
      ),
    );
  return island("member-flows/sponsors-wall", {
    "member-limit": call.props.limit ?? "999999",
    mode: "wall",
    "sponsors-wall": "",
  })(call, context);
};

function sponsors(mode: "grid" | "level"): ContentRenderer {
  return async (call, context) => {
    if (!context.publication) return island("member-flows/sponsors-wall", { mode, "sponsors-wall": "" })(call, context);
    const groups = context.publication.sponsors[sponsorPublicationKey(call.props)];
    if (!groups) throw new Error("Sponsor selection is missing from the publication");
    const display = { groups };
    return component(
      await render(
        mode === "level" ? (
          <SponsorLevelView display={display} eventName={call.props.eventName} />
        ) : (
          <SponsorGridView display={display} eventName={call.props.eventName} rows={call.props.rows === "true"} />
        ),
      ),
    );
  };
}

function frame(kind: Parameters<typeof ContentFrame>[0]["kind"]): ContentRenderer {
  return async (call, context) =>
    component(
      await render(
        <ContentFrame kind={kind}>
          <ContentHtml html={await renderContentMarkdown(call.inner ?? "", context)} />
        </ContentFrame>,
      ),
    );
}

/**
 * The List of Trust Lists, from the snapshot `scripts/sync-trust-list.mjs`
 * writes into `data/ltl.json` and the build bundles.
 *
 * The published site fetched the release while building and rendered the
 * directory into the page. Moving that to the browser broke it outright:
 * GitHub does not allow the cross-origin read and the site's CSP would not
 * allow it either, so the page showed a failure notice instead of the list.
 */
async function trustLists(): Promise<RenderedCall> {
  return component(await render(<TrustLists publishers={trustListPublishers} />));
}

function island(module?: string, defaults: Record<string, string> = {}): ContentRenderer {
  return async (call) =>
    component(
      await render(
        <ContentIsland
          attributes={{ "api-base": "/api/v1", ...defaults, ...call.props }}
          label={call.props.label ?? module?.split("/").at(-1)?.replaceAll("-", " ") ?? "content"}
          module={module}
        />,
      ),
    );
}

async function faq(call: ContentCall): Promise<RenderedCall> {
  const data = objectValue(call.inner);
  const rawGroups = Array.isArray(data.groups) ? data.groups : [];
  const groups = await Promise.all(
    rawGroups.map(async (value) => {
      const group = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const questions = Array.isArray(group.questions) ? group.questions : [];
      return {
        questions: await Promise.all(
          questions.map(async (questionValue) => {
            const question =
              questionValue && typeof questionValue === "object" ? (questionValue as Record<string, unknown>) : {};
            return {
              answerHtml: await markdownHtml(question.answer),
              open: question.open === true,
              question: typeof question.question === "string" ? question.question : undefined,
            };
          }),
        ),
        title: typeof group.title === "string" ? group.title : undefined,
      };
    }),
  );
  return component(await render(<ContentFaq groups={groups} />));
}

async function glossary(call: ContentCall): Promise<RenderedCall> {
  const data = objectValue(call.inner);
  const rawTerms = Array.isArray(data.terms) ? data.terms : [];
  const terms = await Promise.all(
    rawTerms.map(async (value) => {
      const term = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      return {
        definitionHtml: await markdownHtml(term.definition),
        term: String(term.term ?? ""),
      };
    }),
  );
  terms.sort((a, b) => a.term.localeCompare(b.term));
  return component(await render(<ContentGlossary terms={terms} />));
}

async function maturity(call: ContentCall): Promise<RenderedCall> {
  const data = objectValue(call.inner);
  const rawLevels = Array.isArray(data.levels) ? data.levels : [];
  return component(
    await render(
      <ContentMaturity
        levels={rawLevels.map((value) => {
          const level = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
          return {
            color: level.color == null ? undefined : String(level.color),
            label: level.label == null ? undefined : String(level.label),
            number: typeof level.number === "number" || typeof level.number === "string" ? level.number : undefined,
            summary: level.summary == null ? undefined : String(level.summary),
            url: level.url == null ? undefined : String(level.url),
          };
        })}
      />,
    ),
  );
}

async function banner(call: ContentCall): Promise<RenderedCall> {
  const data = objectValue(call.inner);
  const rawLinks = Array.isArray(data.links) ? data.links : [];
  // The published banner rendered its body through `markdownify`, so a link or
  // an emphasis in the YAML reaches the page as markup.
  const body = typeof data.body === "string" ? await inlineMarkdownHtml(data.body) : undefined;
  return component(
    await render(
      <ContentBanner
        body={body}
        heading={typeof data.heading === "string" ? data.heading : undefined}
        links={rawLinks.map((value) => {
          const link = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
          return {
            primary: link.primary === true,
            text: typeof link.text === "string" ? link.text : undefined,
            url: typeof link.url === "string" ? link.url : undefined,
          };
        })}
        stat={typeof data.stat === "string" ? data.stat : undefined}
        statLabel={typeof data.statLabel === "string" ? data.statLabel : undefined}
        style={call.props.style}
      />,
    ),
  );
}

async function collection(
  kind: ContentCollectionKind,
  call: ContentCall,
  context: ContentComponentContext,
): Promise<RenderedCall> {
  const data = objectValue(call.inner);
  const configuredLimit = Number(data.limit);
  const limit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : undefined;
  const listing = context.listing(kind, limit);
  if (typeof data.heading === "string") listing.heading = data.heading;
  return component(
    await render(
      <SiteListingSection
        listing={listing}
        moreHref={typeof data.moreUrl === "string" ? data.moreUrl : undefined}
        moreLabel={typeof data.moreText === "string" ? data.moreText : undefined}
      />,
    ),
  );
}

const renderers: Readonly<Record<string, ContentRenderer>> = {
  agenda: async (_call, context) => component(await renderContentAgenda(context, markdownHtml)),
  alert: async (call, context) =>
    component(
      await render(
        <ContentAlert tone={call.props.type} html={await renderContentMarkdown(call.inner ?? "", context)} />,
      ),
    ),
  "application-status": async () => component(await render(<ApplicationStatusView />)),
  banner,
  button: async (call) =>
    component(
      await render(
        <ContentButtonLink
          href={call.props.link}
          label={call.props.label}
          target={call.props.target}
          variant={buttonVariant(call.props.type)}
        />,
      ),
      false,
    ),
  cards: async (call, context) => component(await renderContentCards(call, context, markdownHtml)),
  carousel: async (call, context) =>
    component(await render(<ContentGallery images={context.assetUrls(call.positional[0] ?? "*")} />)),
  col: async (call, context) =>
    component(
      await render(
        <ContentColumn html={await renderContentMarkdown(call.inner ?? "", context)} options={call.props} />,
      ),
    ),
  criteria: frame("criteria"),
  "donation-disclaimer": async () =>
    component(
      await render(
        <ContentFrame kind="donation">
          Donations to the PKI Consortium, a 501(c)(6) organization, are generally not tax deductible as charitable
          contributions. Please consult your tax adviser.
        </ContentFrame>,
      ),
    ),
  "donation-form": async (call) => component(await render(<DonationForm options={call.props} />)),
  "donation-thank-you": async (call, context) =>
    component(
      await render(
        <div data-module="shared/donation-thank-you">
          <div data-donation-badge hidden />
          <div
            data-donation-pending-content
            hidden
            dangerouslySetInnerHTML={{ __html: await renderContentMarkdown(call.inner ?? "", context) }}
          />
        </div>,
      ),
    ),
  "event-proposal": async () => component(await render(<EventProposalForm />)),
  "event-proposal-manage": async () => component(await render(<EventProposalManagement />)),
  "event-registration": async () => component(await render(<EventRegistrationForm />)),
  "event-registration-confirm": async (call) =>
    component(await render(<EventRegistrationConfirmation options={call.props} />)),
  "event-registration-manage": async () => component(await render(<EventRegistrationManagement />)),
  "event-speaker-manage": async () => component(await render(<EventSpeakerManagement />)),
  "event-speaker-presentation": async () => component(await render(<EventSpeakerPresentation />)),
  "event-sponsor-checkout": island("member-flows/event-sponsor-page", { "event-sponsor": "" }),
  "events-cards": (call, context) => collection("events", call, context),
  // The published shortcode only stashes its YAML for the events layout to
  // read; it draws nothing itself, and `eventsIndex()` reads the same block.
  "events-sidebar": async () => component("", true),
  faq,
  figure: async (call, context) => {
    const src = context.assetUrl(call.props.src) ?? call.props.src;
    return component(
      await render(
        <ContentFigure
          alt={call.props.alt}
          caption={call.props.title}
          className={call.props.class}
          height={call.props.height}
          href={call.props.link}
          src={src ?? ""}
          width={call.props.width}
        />,
      ),
      Boolean(call.props.title),
    );
  },
  glossary,
  "invite-decline": async () => component(await render(<InvitationDeclineForm />)),
  joinform: async (_call, context) => {
    if (!context.membershipDocuments) throw new Error("Membership legal documents are unavailable");
    return component(await render(<JoinFlow documents={await context.membershipDocuments()} />));
  },
  leadership: async (call, context) => {
    if (!context.publication) return island("member-flows/leadership-widget", { leadership: "" })(call, context);
    const group = call.props.group ?? call.positional[0] ?? "";
    const directory =
      context.publication.groups[group] ??
      Object.values(context.publication.groups).find((directory) => directory.group.id === group);
    if (!directory)
      throw new Error(
        `Leadership group "${group}" referenced in ${context.sourcePath} (${context.route}) is missing from the publication snapshot. Check the group slug, active status, and public visibility settings before publishing.`,
      );
    return component(
      await render(
        <GroupGovernanceView
          directory={directory}
          view={call.props.view === "leadership" ? "leadership" : "roster"}
          pastHeadingHtml={await markdownHtml(call.inner)}
        />,
      ),
    );
  },
  ltl: trustLists,
  "maturity-staircase": maturity,
  members: async (call, context) => {
    const island = await memberWall(call, context);
    return component(
      await render(
        <ContentMemberWall className={call.props.class} title={call.props.title}>
          <ContentHtml html={island.html} />
        </ContentMemberWall>,
      ),
    );
  },
  // The slot the news route fills from the D1 cache; the empty state stands when nothing is cached.
  news: async () =>
    component(
      await render(
        <div data-member-news>
          <p class="pk-center pk-muted pk-section">No news items available at this time.</p>
        </div>,
      ),
    ),
  "recent-posts": (call, context) => collection("recent-posts", call, context),
  row: async (call, context) =>
    component(await render(<ContentRow html={await renderContentMarkdown(call.inner ?? "", context)} />)),
  "self-assessment": (call, context) =>
    island("site/self-assessment", {
      "config-url": call.props["config-url"] ?? "config.yaml",
      "data-url": call.props["data-url"] ?? "assessment-data.yaml",
      "self-assessment": "",
      version: "v1.0.3",
    })(call, context),
  "self-assessment-latest": (call, context) =>
    island("site/self-assessment", {
      "self-assessment": "",
      version: call.props.version ?? "develop",
    })(call, context),
  sponsorform: async () => component(await render(<SponsorshipInquiryForm />)),
  sponsors: sponsors("grid"),
  "sponsors-level": sponsors("level"),
  "stat-grid": async (call) => {
    const data = objectValue(call.inner);
    const rawStats = Array.isArray(data.stats) ? data.stats : [];
    return component(
      await render(
        <ContentStats
          stats={rawStats.map((value) => {
            const stat = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
            return {
              label: stat.label == null ? undefined : String(stat.label),
              number: stat.number == null ? undefined : String(stat.number),
            };
          })}
        />,
      ),
    );
  },
  sub: frame("sub"),
  "vote-detail": island("member-flows/vote-detail-page", { "vote-detail": "" }),
  "votes-index": island("member-flows/votes-index-page", { "votes-index": "" }),
  /*
   * `{{< wgmembers PQC >}}` — the participants of one group.
   *
   * The positional argument is the group's slug, so a task force under a
   * working group is addressed the same way its parent is. `category` narrows
   * further when a page wants one membership category within the group.
   */
  wgmembers: async (call, context) => {
    const group = (call.props.group ?? call.positional[0] ?? "").toLowerCase();
    if (context.publication) {
      const members = context.publication.groupMembers[group] ?? [];
      return Promise.resolve(
        component(
          await render(
            <DirectoryGrid
              members={
                call.props.category ? members.filter((member) => member.memberType === call.props.category) : members
              }
              prefix="wg"
            />,
          ),
        ),
      );
    }
    return island("member-flows/member-directory-page", {
      "api-base": "/api/v1",
      "detail-base": "/members/profile/",
      group: "all",
      label: "members",
      "member-directory": "",
      prefix: "wg",
      ...(call.props.category ? { category: call.props.category } : {}),
      "working-group": (call.props.group ?? call.positional[0] ?? "").toLowerCase(),
    })(call, context);
  },
  "working-groups": (call, context) => collection("working-groups", call, context),
  youtube: async (call) =>
    component(await render(<ContentVideo id={call.props.id ?? call.positional[0]} title={call.props.title} />)),
};

export const contentComponentNames = Object.freeze(Object.keys(renderers).sort());

function resolveExpression(name: string, call: ContentCall, context: ContentComponentContext): RenderedCall | null {
  if (name === "param") {
    const key = call.positional[0];
    const params = context.data.params as Record<string, unknown> | undefined;
    const value = key ? (params?.[key] ?? (context.data as Record<string, unknown>)[key]) : undefined;
    return component(value == null ? "" : String(value), false);
  }
  if (name !== "ref") return null;
  const reference = call.positional[0] ?? "";
  if (reference.startsWith("/")) return component(normalizeSitePath(reference), false);
  const base = new URL(context.route, "https://content.invalid");
  return component(normalizeSitePath(new URL(reference, base).pathname), false);
}

async function renderCall(
  name: string,
  argumentSource: string,
  inner: string | undefined,
  context: ContentComponentContext,
): Promise<RenderedCall> {
  const call = { ...parseArguments(argumentSource), inner };
  const expression = resolveExpression(name, call, context);
  if (expression) return expression;
  const renderer = renderers[name];
  if (!renderer) throw new Error(`No content component is registered for ${name} in ${context.sourcePath}`);
  return renderer(call, context);
}

export async function renderContentMarkdown(markdown: string, context: ContentComponentContext): Promise<string> {
  let source = normalizeDirectives(markdown);
  const calls: Array<RenderedCall & { token: string }> = [];
  for (let match = SHORTCODE_BLOCK.exec(source); match; match = SHORTCODE_BLOCK.exec(source)) {
    const rendered = await renderCall(match[1], match[2], match[3], context);
    const token = `PKICCONTENTCOMPONENT${calls.length}TOKEN`;
    calls.push({ ...rendered, token });
    const replacement = rendered.block ? `\n\n${token}\n\n` : token;
    source = `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`;
  }
  for (let match = SHORTCODE_LEAF.exec(source); match; match = SHORTCODE_LEAF.exec(source)) {
    const rendered = await renderCall(match[1], match[2], undefined, context);
    const token = `PKICCONTENTCOMPONENT${calls.length}TOKEN`;
    calls.push({ ...rendered, token });
    const replacement = rendered.block ? `\n\n${token}\n\n` : token;
    source = `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`;
  }
  let html = await renderSiteMarkdown(source, async (src, alt, title) => {
    await prepareSiteImage(src);
    return render(<SiteImage src={src} alt={alt} title={title} loading="lazy" />);
  });
  for (const call of calls) {
    if (call.block) html = html.replace(new RegExp(`<p>\\s*${call.token}\\s*</p>`, "g"), () => call.html);
    html = html.replaceAll(call.token, () => call.html);
  }
  return html
    .replace(
      /<blockquote>\s*<p>([\s\S]*?)\s*\{\.callout-(info|warning)\}<\/p>\s*<\/blockquote>/g,
      '<blockquote class="pk-content-callout pk-content-callout--$2 callout-$2"><p>$1</p></blockquote>',
    )
    .replace(
      /<p>((?:(?!<\/p>)[\s\S])*?)\s*\{\.callout-(info|warning)\}<\/p>/g,
      '<div class="pk-content-callout pk-content-callout--$2 callout-$2"><p>$1</p></div>',
    );
}

export function stripContentComponentSyntax(markdown: string): string {
  let value = normalizeDirectives(markdown);
  for (let pass = 0; pass < 8; pass += 1) {
    const next = value.replace(SHORTCODE_BLOCK, "$3");
    if (next === value) break;
    value = next;
  }
  return value.replace(new RegExp(SHORTCODE_LEAF.source, "g"), "");
}

export function contentCallNames(markdown: string): string[] {
  const names = new Set<string>();
  const expression = /{{[<%]\s*\/?([a-zA-Z0-9_-]+)\b[^}]*[>%]}}/g;
  for (const match of normalizeDirectives(markdown).matchAll(expression)) names.add(match[1]);
  return [...names].sort();
}
