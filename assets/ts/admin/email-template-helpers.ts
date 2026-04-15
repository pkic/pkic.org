export type TemplateHelperCategory = "Variables" | "Conditions" | "CTAs";

interface TemplateHelperItem {
  category: TemplateHelperCategory;
  label: string;
  snippet: string;
  target?: "subject" | "body";
}

export const TEMPLATE_HELPERS: TemplateHelperItem[] = [
  { category: "Variables", label: "eventName", snippet: "{{eventName}}", target: "subject" },
  { category: "Variables", label: "firstName", snippet: "{{firstName}}" },
  { category: "Variables", label: "proposalTitle", snippet: "{{proposalTitle}}" },
  { category: "Variables", label: "deadline", snippet: "{{deadline}}" },
  { category: "Variables", label: "daysUntilExpiry", snippet: "{{daysUntilExpiry}}" },
  { category: "Variables", label: "daysUntilDeadline", snippet: "{{daysUntilDeadline}}" },
  { category: "Conditions", label: "isReminder", snippet: "{{#if isReminder}}\n\n{{/if}}" },
  { category: "Conditions", label: "if eq", snippet: '{{#if eq status "accepted"}}\n\n{{/if}}' },
  { category: "Conditions", label: "if lte", snippet: '{{#if lte daysUntilExpiry "2"}}\n\n{{/if}}' },
  { category: "Conditions", label: "else block", snippet: "{{#if isReminder}}\n\n{{else}}\n\n{{/if}}" },
  { category: "Conditions", label: "unless", snippet: "{{#unless hasHeadshot}}\n\n{{/unless}}" },
  { category: "Conditions", label: "each", snippet: "{{#each attendees}}\n- {{this}}\n{{/each}}" },
  {
    category: "CTAs",
    label: "CTA register",
    snippet: '<div class="cta"><a href="{{registrationUrl}}">Register now &rarr;</a></div>',
  },
  {
    category: "CTAs",
    label: "CTA proposal",
    snippet: '<div class="cta"><a href="{{proposalUrl}}">Submit a proposal &rarr;</a></div>',
  },
  {
    category: "CTAs",
    label: "CTA upload",
    snippet: '<div class="cta"><a href="{{uploadUrl}}">Upload my presentation &rarr;</a></div>',
  },
];
