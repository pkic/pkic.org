import { attachPersonPreview } from "../site/static-person-preview";

// Published cards keep their server-rendered profile and tenure. Only their preview needs a client owner.
for (const card of document.querySelectorAll<HTMLElement>(".person-card[data-person-card]")) {
  if (card.dataset.personCardHydrated === "true") continue;
  const toggle = card.querySelector<HTMLButtonElement>("button.person-card-name");
  if (card.dataset.personCard && toggle) attachPersonPreview(card, JSON.parse(card.dataset.personCard), toggle);
}
