/**
 * Starting points for an event's tickets. An organizer picks one when adding
 * a ticket and edits it; nothing here is read after the ticket is saved.
 *
 * The key names the audience the ticket is about, so an event that uses the
 * same key and the same "who qualifies" text reuses the decisions already
 * made for organizations. `pqcc_` is the post-quantum cryptography conference:
 * its vendors are everyone who sells into PKI, cryptography or quantum-safe
 * technology. A conference about PKI alone would define `pki_vendor` instead.
 */
export interface EventTicketStarter {
  key: string;
  name: string;
  descriptionMarkdown: string;
  /** Who qualifies, written about the organization and never about one person's role. */
  classifierDescription: string;
  isDefault: boolean;
  freeRequiresWorkEmail: boolean;
}

export const EVENT_TICKET_STARTERS: readonly EventTicketStarter[] = [
  {
    key: "pqcc_attendee",
    name: "Attendee",
    descriptionMarkdown: [
      "For people whose organization **uses or runs** PKI and cryptography for itself.",
      "",
      "- Banks, telecoms, manufacturers, healthcare and other companies that buy and operate these technologies",
      "- Government agencies, universities and research institutes",
      "- Standards bodies and non-profits",
    ].join("\n"),
    classifierDescription: [
      "The organization buys, deploys or operates PKI, digital certificates, cryptography, hardware security modules, key management or quantum-safe technology for its own use, and does not sell them to others.",
      "Includes banks, insurers, telecoms, manufacturers, retailers, healthcare providers, utilities and any other enterprise whose security or PKI team serves the organization itself.",
      "Includes government agencies, the military, regulators, universities, research institutes, standards bodies and non-profits, even when they publish cryptographic research or standards.",
      "An in-house PKI or cryptography team does not make an organization a vendor.",
    ].join(" "),
    isDefault: true,
    freeRequiresWorkEmail: true,
  },
  {
    key: "pqcc_vendor",
    name: "Vendor",
    descriptionMarkdown: [
      "For people whose organization **sells or provides** PKI, cryptography or quantum products or services.",
      "",
      "- Product and service vendors, resellers and integrators",
      "- Consulting and managed services, including post-quantum readiness and migration",
    ].join("\n"),
    classifierDescription: [
      "The organization develops, sells, resells, licenses or integrates products or services for PKI, digital certificates, certificate lifecycle management, cryptography including post-quantum cryptography, hardware security modules, key management, cryptographic discovery or inventory, or quantum and quantum-safe technology.",
      "Includes certificate authorities and trust service providers that sell certificates or signing services.",
      "Includes consultancies, system integrators, auditors and managed service providers that offer PKI, cryptography, crypto-agility, or post-quantum readiness, assessment or migration services to clients. A large consultancy or technology company with such a practice counts as a whole, whatever the person's own department.",
      "Includes cloud, semiconductor, network and software companies that market cryptographic or quantum-safe capabilities as a product.",
      "Everyone who works for such an organization counts, whatever their role.",
    ].join(" "),
    isDefault: false,
    freeRequiresWorkEmail: false,
  },
];
