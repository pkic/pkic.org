import { publicVoteSchema } from "../../shared/schemas/votes";

const slug = new URL(window.location.href).searchParams.get("slug");
const template = document.querySelector<HTMLTemplateElement>("#published-vote-paths");
if (slug && template) {
  const paths = publicVoteSchema
    .pick({ slug: true })
    .array()
    .parse(JSON.parse(template.content.textContent ?? "[]"));
  if (paths.some((vote) => vote.slug === slug)) window.location.replace(`/votes/${encodeURIComponent(slug)}/`);
}
