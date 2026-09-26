const messages = globalThis.document.querySelector("#messages");
const status = globalThis.document.querySelector("#status");
let lastSnapshot = "";

function element(tag, text) {
  const node = globalThis.document.createElement(tag);
  node.textContent = text;
  return node;
}

async function refresh() {
  try {
    const response = await fetch("/outbox", { cache: "no-store" });
    if (!response.ok) throw new Error("Inbox unavailable");
    const items = await response.json();
    status.textContent = items.length
      ? `${items.length} captured message${items.length === 1 ? "" : "s"}. Nothing has been delivered.`
      : "No messages yet. Trigger an email in the application; it will appear here.";
    const snapshot = JSON.stringify(items);
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    messages.replaceChildren();
    for (const message of items.toReversed()) {
      const card = element("article", "");
      card.append(element("h2", message.subject), element("p", `Captured ${message.capturedAt}`));
      for (const recipients of message.payload.personalizations ?? []) {
        for (const kind of ["to", "cc", "bcc"]) {
          if (recipients[kind]?.length)
            card.append(
              element("p", `${kind.toUpperCase()}: ${recipients[kind].map((item) => item.email).join(", ")}`),
            );
        }
      }
      const plain =
        message.payload.content?.find((part) => part.type === "text/plain")?.value ??
        "No plain-text body. Expand the payload below to inspect the HTML source.";
      card.append(element("pre", plain));
      for (const candidate of new Set(plain.match(/https?:\/\/[^\s<>"']+/g) ?? [])) {
        const url = new URL(candidate);
        // Only local links become clickable; remote images/HTML are never loaded.
        if (!["localhost", "127.0.0.1"].includes(url.hostname)) continue;
        const link = element("a", "Open local application link");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        card.append(link);
      }
      const details = element("details", "");
      details.append(
        element("summary", "Complete payload, including HTML and attachments"),
        element("pre", JSON.stringify(message.payload, null, 2)),
      );
      card.append(details);
      messages.append(card);
    }
  } catch {
    status.textContent = "The inbox is unavailable. Check that the local capture server is running.";
  }
}
globalThis.document.querySelector("#refresh").addEventListener("click", refresh);
void refresh();
setInterval(refresh, 2000);
