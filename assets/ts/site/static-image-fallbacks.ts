/** Static public markup needs the same fallback that mounted components handle on error. */
export function observeStaticImageFallbacks(root: HTMLElement): () => void {
  const events = new AbortController();
  function fallback(image: HTMLImageElement) {
    const avatar = image.closest<HTMLElement>("[data-avatar-fallback]");
    const organization = image.closest<HTMLElement>(".pk-agenda-speaker-organization");
    if (!avatar && !organization) return;
    const text = document.createElement("span");
    if (avatar) {
      text.className = "pk-avatar__initials";
      text.textContent = avatar.dataset.avatarFallback ?? "";
      avatar.replaceChildren(text);
    } else if (organization) {
      text.textContent = image.alt;
      organization.replaceWith(text);
    }
  }
  root.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLImageElement) fallback(event.target);
    },
    { capture: true, signal: events.signal },
  );
  for (const image of root.querySelectorAll<HTMLImageElement>("img[src]")) {
    if (image.complete && image.naturalWidth === 0 && image.getAttribute("src")) fallback(image);
  }
  return () => events.abort();
}
