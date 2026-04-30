export type TemplateHelperCategory = "Variables" | "Conditions" | "CTAs";

export interface TemplateHelperItem {
  category: TemplateHelperCategory;
  label: string;
  snippet: string;
  target?: "subject" | "body" | null;
}

export interface TemplatePartialItem {
  name: string;
  description: string;
}

// Partials are block-level includes registered in the email render engine.
export const TEMPLATE_PARTIALS: TemplatePartialItem[] = [
  { name: "reg_details", description: "Registration summary (name, attendance, custom answers)" },
  { name: "sponsors_block", description: "Sponsors section" },
  { name: "about_pkic", description: "About PKIC blurb" },
  { name: "donation_request", description: "Donation request block" },
];

// Default sample values used when no custom preview data is provided.
export const PREVIEW_DEFAULTS: Record<string, unknown> = {
  // Event
  eventName: "PKI Consortium Conference 2026",
  eventUrl: "https://pkic.org/events/2026/conference/",
  eventTimezone: "America/New_York",
  eventStartsAt: "2026-10-01T09:00:00Z",
  eventEndsAt: "2026-10-03T17:00:00Z",
  // Registrant
  firstName: "Jane",
  lastName: "Doe",
  email: "jane.doe@example.com",
  organizationName: "Example Corp",
  jobTitle: "Security Engineer",
  // Registration
  status: "registered",
  statusLabel: "Registered",
  attendanceType: "in_person",
  attendanceLabel: "In-person",
  manageUrl: "https://pkic.org/events/2026/conference/manage/?token=sample",
  acceptedTermsText: "I agree to the Code of Conduct.",
  waitlistOfferNotice: false,
  // Day attendance
  dayAttendance: [
    { dayLabel: "Wednesday 1 October 2026", attendanceLabel: "In-person", statusLabel: "Confirmed" },
    { dayLabel: "Thursday 2 October 2026", attendanceLabel: "Virtual", statusLabel: "Confirmed" },
  ],
  // Custom answers
  customAnswerRows: [
    { label: "Dietary requirements", displayValue: "Vegetarian" },
    { label: "T-shirt size", displayValue: "M" },
  ],
  // Speaker / proposal
  proposalTitle: "Post-Quantum PKI in Practice",
  proposalAbstract: "An exploration of PQC migration strategies for enterprise PKI.",
  speakerStatus: "accepted",
};

export const TEMPLATE_HELPERS: TemplateHelperItem[] = [
  // ── Variables ──────────────────────────────────────────────────────────────
  // Event
  { category: "Variables", label: "eventName", snippet: "{{eventName}}", target: "subject" },
  { category: "Variables", label: "eventUrl", snippet: "{{eventUrl}}", target: "body" },
  { category: "Variables", label: "eventTimezone", snippet: "{{eventTimezone}}", target: "body" },
  // Registrant
  { category: "Variables", label: "firstName", snippet: "{{firstName}}" },
  { category: "Variables", label: "lastName", snippet: "{{lastName}}" },
  { category: "Variables", label: "email", snippet: "{{email}}" },
  { category: "Variables", label: "organizationName", snippet: "{{organizationName}}" },
  { category: "Variables", label: "jobTitle", snippet: "{{jobTitle}}" },
  // Registration
  { category: "Variables", label: "status", snippet: "{{status}}" },
  { category: "Variables", label: "statusLabel", snippet: "{{statusLabel}}" },
  { category: "Variables", label: "attendanceType", snippet: "{{attendanceType}}" },
  { category: "Variables", label: "attendanceLabel", snippet: "{{attendanceLabel}}" },
  { category: "Variables", label: "manageUrl", snippet: "{{manageUrl}}" },
  { category: "Variables", label: "acceptedTermsText", snippet: "{{acceptedTermsText}}" },
  // Speaker / proposal
  { category: "Variables", label: "proposalTitle", snippet: "{{proposalTitle}}" },
  { category: "Variables", label: "proposalAbstract", snippet: "{{proposalAbstract}}" },
  { category: "Variables", label: "speakerStatus", snippet: "{{speakerStatus}}" },

  // ── Conditions ────────────────────────────────────────────────────────────
  {
    category: "Conditions",
    label: "if firstName",
    snippet: "{{#if firstName}}{{firstName}}{{else}}Registrant{{/if}}",
    target: "body",
  },
  { category: "Conditions", label: "if eq status", snippet: '{{#if eq status "accepted"}}\n\n{{/if}}', target: "body" },
  {
    category: "Conditions",
    label: "if waitlistOfferNotice",
    snippet: "{{#if waitlistOfferNotice}}\n\n{{/if}}",
    target: "body",
  },
  {
    category: "Conditions",
    label: "if acceptedTermsText",
    snippet: "{{#if acceptedTermsText}}\n\n{{/if}}",
    target: "body",
  },
  { category: "Conditions", label: "else block", snippet: "{{#if condition}}\n\n{{else}}\n\n{{/if}}", target: "body" },
  { category: "Conditions", label: "unless", snippet: "{{#unless condition}}\n\n{{/unless}}", target: "body" },
  {
    category: "Conditions",
    label: "each customAnswerRows",
    snippet: "{{#each customAnswerRows}}\n**{{label}}:** {{displayValue}}\n{{/each}}",
    target: "body",
  },
  {
    category: "Conditions",
    label: "each dayAttendance",
    snippet: "{{#each dayAttendance}}\n- **{{dayLabel}}:** {{attendanceLabel}} ({{statusLabel}})\n{{/each}}",
    target: "body",
  },

  // ── CTAs ──────────────────────────────────────────────────────────────────
  {
    category: "CTAs",
    label: "CTA button",
    snippet: '<div class="cta"><a href="{{url}}">Label &rarr;</a></div>',
    target: "body",
  },
];
