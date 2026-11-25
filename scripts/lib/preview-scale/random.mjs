/**
 * Deterministic randomness and invented names for the preview-scale seed.
 *
 * Every value comes from a seeded generator, so the same options always
 * produce the same people. Names are combined from short hand-written lists of
 * common given names and surnames from many regions, never taken from a real
 * record, and include the shapes production data has: accents, hyphens,
 * apostrophes, particles, double surnames and the occasional very long name.
 * The email domain is the reserved `.invalid` top-level domain, under which no
 * mailbox can exist.
 */

/** A small, fast seeded generator (mulberry32). Returns floats in [0, 1). */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** An independent stream per purpose, so one part of the plan never shifts another. */
export function seededStream(seed, purpose) {
  let hash = seed >>> 0;
  for (const character of purpose) hash = Math.imul(hash ^ character.codePointAt(0), 0x01000193) >>> 0;
  return seededRandom(hash);
}

export function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

/** Choose a key by weight, e.g. `{ in_person: 32, virtual: 42 }`. */
export function weighted(random, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll < 0) return key;
  }
  return entries.at(-1)[0];
}

const FIRST_NAMES = [
  "Aisha", "Alejandro", "Amara", "Anders", "Ana", "Arjun", "Astrid", "Beatriz", "Bram", "Chen", "Chiara", "Daniel",
  "Dara", "Elif", "Elena", "Emeka", "Erik", "Fatima", "Felipe", "Freya", "Hana", "Hiroshi", "Inês", "Ivan", "Jana",
  "Javier", "Joon-ho", "Julia", "Kai", "Kamala", "Karin", "Kofi", "Lars", "Leila", "Lena", "Liam", "Lucía", "Malik",
  "Maren", "Mateo", "Mei", "Mika", "Nadia", "Nikolai", "Noor", "Olga", "Omar", "Pieter", "Priya", "Rafael", "Rania",
  "Ravi", "Rosa", "Saanvi", "Samuel", "Sanne", "Sofia", "Stefan", "Tariq", "Thandiwe", "Tomás", "Uma", "Valentina",
  "Wei", "Yara", "Yusuf", "Zainab", "Zoë", "Björn", "Søren", "Łucja", "Ngozi", "Hamid", "Grace", "Oskar", "Ilse",
  "Jean-Luc", "Anne-Marie", "Marie-Claire", "Hans-Peter", "François", "Zoltán", "Dagný", "Ðorđe", "Çağla", "Seán",
  "Siobhán", "Niamh", "Jürgen", "Mário", "Aleksandra", "Bogdan", "Radu", "Ştefan", "Kateřina", "Jiří", "Agnieszka",
  "Paweł", "Dmitri", "Anastasia", "Giorgos", "Eleni", "Mehmet", "Ayşe", "Reza", "Shirin", "Abdullah", "Mariam",
  "Chinedu", "Oluwaseun", "Wanjiru", "Kwame", "Thabo", "Lindiwe", "Sipho", "Xiaoming", "Yuki", "Haruto", "Min-jun",
  "Seo-yeon", "Nguyễn Anh", "Thanh", "Rahul", "Ananya", "Lakshmi", "Venkatesh", "Mohammed", "Leilani", "Tāne",
  "Aroha", "Mateus", "João", "Gabriela", "Camila", "Santiago", "Ximena", "Nicolás", "Renée", "Chloé", "Benoît",
  "Hélène", "Matthias", "Annika", "Sven", "Ingrid", "Eero", "Aino", "Jóhanna", "Kristján", "Gintarė", "Jānis",
  "Mart", "Ivana", "Luka", "Ana-Maria", "Sinéad", "Dafydd", "Rhiannon", "Ruairí", "Ali", "Bo", "Ed", "Li",
];

const LAST_NAMES = [
  "Abara", "Achterberg", "Alvarez", "Andersen", "Bakker", "Banerjee", "Becker", "Bergström", "Castillo", "Chen",
  "Costa", "Dahl", "de Groot", "Dimitrov", "Dubois", "Eriksen", "Ferreira", "Fischer", "García", "Haddad", "Hansen",
  "Hoffmann", "Ibrahim", "Ito", "Jansen", "Kapoor", "Kim", "Kowalski", "Larsen", "Li", "Lindqvist", "Mahmoud",
  "Martins", "Mensah", "Moreau", "Müller", "Nakamura", "Nguyễn", "Novák", "Okafor", "Olsen", "Park", "Patel",
  "Petrov", "Popescu", "Quispe", "Ramos", "Rossi", "Sato", "Schmidt", "Silva", "Singh", "Smit", "Takahashi",
  "Tanaka", "van Dijk", "van der Berg", "Visser", "Wagner", "Wang", "Weber", "Wiśniewska", "Yılmaz", "Zhang",
  "Ó Briain", "Núñez", "Østergaard", "Al-Farsi", "Mbeki", "Kovač", "Horvat", "Lindgren", "Sørensen", "Adeyemi",
  "O'Connor", "O'Sullivan", "D'Angelo", "dell'Acqua", "MacLeod", "McAllister", "von Braun", "zu Hohenlohe",
  "van 't Hof", "de la Cruz", "dos Santos", "da Silva", "Le Roux", "El Amrani", "ben Haim", "Abu-Bakr", "bin Rashid",
  "Ølstad", "Åkesson", "Lødrup", "Häkkinen", "Järvinen", "Þórsdóttir", "Guðmundsson", "Čapek", "Dvořák",
  "Šimková", "Żółkiewski", "Brzęczyszczykiewicz", "Szczepańska", "Gonçalves", "Conceição", "Ibáñez", "Peña",
  "Çelik", "Öztürk", "Şahin", "Vũ", "Trần", "Lê", "Phạm", "Kumar", "Venkataraman", "Raghunathan", "Subramanian",
  "Chakraborty", "Ogunleye", "Nwachukwu", "Mwangi", "Dlamini", "Ndlovu", "Takeda", "Yamamoto", "Hashimoto",
  "Choi", "Jeong", "Huang", "Liu", "Zhao", "Hernández", "Rodríguez", "López", "Sánchez", "Kristiansen", "Nieminen",
  "Papadopoulos", "Konstantinidis", "Vasilakis", "Kuznetsov", "Ivanova", "Shevchenko", "Bondarenko", "Jovanović",
  "Petrović", "Nagy", "Szabó", "Tóth", "Kask", "Bērziņš", "Kazlauskas", "Wójcik", "Lefèvre", "Fontaine", "Girard",
  "Wolf", "Ng", "Ma", "Wu", "Xu", "Ek", "Oh",
];

/** A double or hyphenated surname for about one person in ten, and rarely a very long one. */
function inventLastName(random) {
  const roll = random();
  const first = pick(random, LAST_NAMES);
  if (roll < 0.05) return `${first}-${pick(random, LAST_NAMES)}`;
  if (roll < 0.1) return `${first} ${pick(random, LAST_NAMES)}`;
  if (roll < 0.105) return `${first} ${pick(random, LAST_NAMES)} ${pick(random, LAST_NAMES)}-${pick(random, LAST_NAMES)}`;
  return first;
}

/** A given name, sometimes with a middle name or initial. */
function inventFirstName(random) {
  const roll = random();
  const first = pick(random, FIRST_NAMES);
  if (roll < 0.06) return `${first} ${pick(random, FIRST_NAMES)}`;
  if (roll < 0.1) return `${first} ${String.fromCharCode(65 + Math.floor(random() * 26))}.`;
  return first;
}

/** The person's name and an address under the reserved `.invalid` domain. */
export function inventPerson(random, index) {
  const firstName = inventFirstName(random);
  const lastName = inventLastName(random);
  const ascii = (value) =>
    value
      .replaceAll("ł", "l")
      .replaceAll("Ł", "L")
      .replaceAll("ø", "o")
      .replaceAll("Ø", "O")
      .replaceAll("đ", "d")
      .replaceAll("Đ", "D")
      .replaceAll("þ", "th")
      .replaceAll("Þ", "Th")
      .replaceAll("ı", "i")
      .normalize("NFKD")
      .replace(/[^A-Za-z]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  return { firstName, lastName, email: `${ascii(firstName)}.${ascii(lastName)}.${index}@scale-test.invalid` };
}

const ORGANIZATION_WORDS = [
  "Aurora", "Basalt", "Beacon", "Cobalt", "Copperleaf", "Corvid", "Driftwood", "Ember", "Fjord", "Granite",
  "Harbor", "Helix", "Ironbark", "Juniper", "Kestrel", "Lantern", "Larch", "Meridian", "Nimbus", "Northgate",
  "Obsidian", "Orchid", "Paragon", "Quartz", "Riverstone", "Saffron", "Sextant", "Silverline", "Tamarind",
  "Tidewater", "Umber", "Vantage", "Wayfarer", "Willow", "Zephyr", "Alder", "Bramble", "Cinder", "Dovetail", "Elm",
  "Nordlicht", "Sólvangur", "Étoile", "Kraków Digital", "Zürichsee", "Ålesund", "Hōkū", "Sakura", "Baobab",
  "Kilimanjaro", "Andes", "Atlas", "Polaris", "Vega", "Orion", "Lyra", "Halcyon", "Keystone", "Bastion", "Rampart",
];

const ORGANIZATION_KINDS = [
  "Trust Services", "Security", "Labs", "Systems", "Networks", "Identity", "Certification Authority", "Bank",
  "Telecom", "Cloud", "Health", "Payments", "Automotive", "Energy", "Cryptography", "Digital", "Software",
  "Semiconductors", "Consulting", "Insurance", "Logistics", "Defense Systems", "Mobility", "Data Centers",
];

const BRAND_SUFFIXES = ["Sign", "Key", "Cert", "Trust", "Sec", "ID", "Vault", "Gate", "Quantum", "Crypt"];

const LEGAL_FORMS = ["", "", "", "", " Inc.", " Ltd.", " GmbH", " B.V.", " S.A.", " AG", " A/S", " Oy", " AB", " S.p.A.", " Sp. z o.o.", " K.K.", " Pty Ltd", " LLC", " & Co. KG", " S.à r.l."];

const INSTITUTIONS = [
  "University of {place}", "{place} Institute of Technology", "Technische Universität {place}", "Université de {place}",
  "{place} Ministry of Digital Affairs", "National Cyber Security Centre of {place}", "{place} Central Bank",
  "Municipality of {place}", "{place} Hospital Group", "{place} Polytechnic",
];

const PLACES = [
  "Amsterdam", "Utrecht", "Leuven", "Zürich", "Göteborg", "Tromsø", "Łódź", "Brno", "Kraków", "Bologna", "Porto",
  "Sevilla", "Montréal", "Québec", "São Paulo", "Medellín", "Bogotá", "Nairobi", "Lagos", "Accra", "Kigali", "Pune",
  "Bengaluru", "Hyderabad", "Kyōto", "Sendai", "Daejeon", "Taipei", "Đà Nẵng", "Tallinn", "Rīga", "Vilnius",
  "Reykjavík", "Aarhus", "Tampere", "Graz", "Linz", "Košice", "Cluj-Napoca", "Thessaloniki", "İzmir", "Haifa",
];

/**
 * Unique organization names in the styles production has: brand plus sector,
 * legal forms from many jurisdictions, public institutions and the odd short
 * acronym. `taken` holds normalized names already used, so names stay unique
 * without a numeric suffix.
 */
export function inventOrganization(random, taken) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const roll = random();
    let name;
    if (roll < 0.12) name = pick(random, INSTITUTIONS).replace("{place}", pick(random, PLACES));
    else if (roll < 0.17)
      name = `${Array.from({ length: 2 + Math.floor(random() * 2) }, () => pick(random, ORGANIZATION_WORDS)[0]).join("")}${pick(random, ["", "", " Group", " Holding"])}`;
    else if (roll < 0.3) name = `${pick(random, ORGANIZATION_WORDS)}${pick(random, BRAND_SUFFIXES)}${pick(random, LEGAL_FORMS)}`;
    else name = `${pick(random, ORGANIZATION_WORDS)} ${pick(random, ORGANIZATION_KINDS)}${pick(random, LEGAL_FORMS)}`;
    const normalized = name.toLowerCase();
    if (!taken.has(normalized)) {
      taken.add(normalized);
      return name;
    }
  }
  throw new Error("Could not invent a unique organization name; lower the attendee count.");
}

const SENIORITY = ["", "", "", "Senior ", "Lead ", "Principal ", "Staff ", "Chief ", "Junior ", "Associate "];
const ROLES = [
  "Security Architect", "PKI Engineer", "Cryptography Researcher", "Product Manager", "Solutions Engineer",
  "Compliance Officer", "Software Engineer", "Policy Advisor", "Consultant", "Risk Manager", "Standards Editor",
  "DevSecOps Engineer", "Identity Architect", "Trust Services Manager", "Auditor", "Developer Advocate",
];
const STANDALONE_TITLES = [
  "CISO", "CTO", "CEO & Co-founder", "Professor", "PhD candidate", "Head of Identity", "IT Director",
  "VP, Product Security", "Director, Cryptographic Engineering", "Founder", "Fellow",
  "Head of PKI & Certificate Lifecycle Management, Group Information Security",
  "Programme Manager, Post-Quantum Cryptography Migration (EMEA)", "Researcher", "Student",
];

/** A job title, from a one-word role to a long committee-style title. */
export function inventJobTitle(random) {
  if (random() < 0.25) return pick(random, STANDALONE_TITLES);
  return `${pick(random, SENIORITY)}${pick(random, ROLES)}`;
}
