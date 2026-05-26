---
date: 2026-05-07T00:00:00Z
linkTitle: "3 — Advanced"
title: "Level 3 (Advanced) - Post-Quantum Cryptography Maturity Model (PQCMM)"
description: A product at Level 3 maintains a full cryptographic inventory, documents non-quantum-safe features as risks, produces an SBOM, and has crypto-agility mechanisms for key features.
summary: Level 3 adds full cryptographic visibility and agility. Vendors can account for all cryptographic use cases and update algorithms without major redesign.

weight: 40
sectionNav: true
---

## What Level 3 Means

A product at **Level 3** has moved beyond simply offering quantum-safe features — it provides the **cryptographic transparency and architectural flexibility** needed for organizations to manage their migration systematically.

The vendor has catalogued every cryptographic use case in the product, explicitly acknowledged which ones are not yet quantum-safe, and built mechanisms that allow algorithm updates without requiring a complete architectural overhaul.

> Level 3 gives organizations the **visibility to plan** and the **agility to execute** a controlled cryptographic migration.
{.callout-info}

## Criteria

{{< criteria >}}
A product meets Level 3 when all Level 2 criteria are met, plus:

- A **full cryptographic inventory** is maintained, covering all use cases within the product where cryptography is applied. The inventory must address every applicable category in the **Cryptographic Inventory Taxonomy** below; categories that do not apply to the product must be marked *not applicable* with a written justification — categories may not be omitted.
- Non-quantum-safe features are **formally documented and flagged** — either for planned remediation, risk acceptance, or compensating controls.
- A **Software Bill of Materials (SBOM)** or equivalent component inventory is available, enabling consumers to identify cryptographic dependencies.
- **Crypto-agility mechanisms** exist for key product features: at least two algorithms can be selected for the same cryptographic role through configuration (for example two different signature algorithms, or a pure-PQC vs. hybrid option in the same role) without major architectural redesign or a hardware refresh. Selecting only between parameter sets of the same algorithm (for example ML-KEM-768 and ML-KEM-1024) does not by itself satisfy this criterion.
- A documented **HNDL exposure register** identifies which data flows handled by the product carry a Harvest-Now-Decrypt-Later risk (long-lived confidentiality requirement), and which algorithm protects each.
{{< /criteria >}}

### Cryptographic Inventory Taxonomy

A Level 3 cryptographic inventory must cover, at minimum, the following categories. For each category, list the algorithms, parameter sets, and components used — or mark the category *not applicable* with a justification:

- Data in transit (e.g., TLS, VPN, application protocols)
- Data at rest (e.g., disk, database, object storage encryption)
- Identity, authentication, and certificates
- Code, firmware, and update signing
- Key wrapping and key-encryption keys (KEKs)
- Random number generation and entropy sources
- Telemetry, logging, and audit-trail integrity
- Build, CI/CD, and supply-chain signing (where part of the product)
- Attestation and remote-attestation (where applicable)
- Backup, archival, and long-term storage

## Assessment Questions

At Level 3, the assessor must validate inventory completeness and SBOM accuracy using tooling, not just documentation review. The most significant findings at this level are gaps between what tools report and what the vendor discloses. **A complete Level 3 assessment must also work through all [Level 1](/wg/pqc/pqcmm/levels/1-initial/#assessment-questions) and [Level 2](/wg/pqc/pqcmm/levels/2-basic/#assessment-questions) questions.**

### Assessment methodology record

The assessment report must record:

- **SBOM analysis** — tool name and version (e.g., Syft, cdxgen, Dependency-Track, Microsoft sbom-tool), and date run.
- **Quantum-safety check** — tool or script used to identify quantum-unsafe libraries or algorithm identifiers in the SBOM/CBOM, findings summary, and date.
- **Inventory cross-check** — whether inventory claims were verified against SBOM tool output, and whether any code-level check was performed.
- **Code review** (if performed) — manual or automated; tool(s) used (e.g., Semgrep, CodeQL, grep-based algorithm identifier search); scope (full codebase / cryptographic modules only / dependency list only); and findings.
- **Tool-vs-disclosure gaps** — each discrepancy between tool output and vendor disclosure recorded individually.
- **Unverified claims** — flag each explicitly as *"vendor-stated, not independently verified"*.

> Discrepancies between tool findings and vendor disclosure are the most significant findings at Level 3 — each must be individually recorded.
{.callout-info}

### Cryptographic Inventory

| # | Question | Assessment guidance |
|---|---|---|
| 3.1 | Can the vendor provide the cryptographic inventory for the assessed product version? | Request the inventory document. Record: title, version number (must correspond to the assessed product release — not a generic or latest-version document), date of last update, and format. A complete inventory entry must include: algorithm name, parameter set, key size, usage context, and component name — e.g., "ML-KEM-768 — TLS 1.3 key exchange — server-side — component: tls-engine v2.3". Entries listing only the algorithm name without parameter set and component attribution are incomplete — record which fields are missing. |
| 3.2 | Does each inventory entry include algorithm, parameter set, key size, usage context, and component? | Sample at least five entries across different components. For each sampled entry, record whether all five fields are present. An entry showing "ML-KEM" without a parameter set (512 / 768 / 1024) cannot be independently verified against a standard — flag each such entry. |
| 3.3 | How frequently is the inventory reviewed and updated? | Request the inventory for the current and one previous product release. Compare entries. Record the version and last-updated date for each document. An inventory with no changes between major releases that included PQC updates is not actively maintained — record this as a process gap. |

### Non-Quantum-Safe Feature Disclosure

| # | Question | Assessment guidance |
|---|---|---|
| 3.4 | Does the product contain any features that still use non-quantum-safe algorithms? If yes, list them by component and algorithm. | Cross-reference the vendor's disclosure against SBOM analysis: run the SBOM through a quantum-safety checking tool (e.g., a CycloneDX crypto analyser or a script that checks library versions against a known PQC-capable threshold). Record: tool name and version, date run, and any gap between tool findings and vendor disclosure. Each gap is a finding and must be individually recorded with the component name, algorithm, and the vendor's explanation (or its absence). Ask explicitly: "What features in this product cannot currently operate with quantum-safe algorithms only?" |
| 3.5 | For each non-quantum-safe feature: is the risk formally documented with a target remediation date? | Record each non-quantum-safe feature with: algorithm name and parameter set, component, risk acceptance statement reference (document title, version, date), and target remediation version/date. "Some legacy features remain" without a feature-by-feature breakdown is not acceptable. Each non-quantum-safe feature must have its own entry. |
| 3.6 | Can the vendor provide a redacted or anonymised SBOM or CBOM that preserves algorithm-level detail? | Record the format (SPDX / CycloneDX), schema version, and the scope of redaction (e.g., "proprietary component names removed, algorithm entries preserved"). A redacted artefact that removes all algorithm data is not useful — record this as a limitation of the evidence. If the vendor refuses to provide any inventory artefact in any form, record this explicitly and flag it as a risk signal that limits the evidential basis of the assessment. |

### SBOM

| # | Question | Assessment guidance |
|---|---|---|
| 3.7 | Does the vendor provide an SBOM in SPDX or CycloneDX format? | Request the SBOM for the assessed product version. Record: format and schema version (e.g., CycloneDX 1.6), generation tool and version (e.g., Syft 1.4.0, cdxgen 10.7, Microsoft sbom-tool 2.x), generation method (automated CI pipeline / manual export / hybrid), generation date, and the product version covered. Validate the SBOM using a validator (e.g., CycloneDX CLI at https://github.com/CycloneDX/cyclonedx-cli, or NTIA minimum elements checker). Record the validation result. Run a quantum-safety check and compare against the vendor's own disclosure — record any gaps. |
| 3.8 | Does the SBOM include cryptographic library dependencies with version numbers? | Check that all cryptographic libraries appear in the SBOM with explicit version numbers — a library entry without a version cannot be assessed. Common libraries to look for include OpenSSL (with or without oqs-provider), wolfSSL, Bouncy Castle, AWS-LC, Microsoft CNG / BCryptPrimitives, NSS, mbedTLS, LibreSSL, Botan, and Crypto++. For each library, the assessor must independently verify — from the library's own official release notes or PQC documentation page — whether the listed version supports the vendor's claimed quantum-safe algorithms. A library version that does not support the claimed algorithm is a finding; record the library name, listed version, and the vendor's explanation. Record any library whose version number is absent. |
| 3.9 | Is the SBOM updated with each product release? | Request SBOMs for the current and one previous release. Compare the library entries and version numbers. If two SBOMs are identical for releases that should have included dependency updates, the SBOM process is likely not integrated with the build pipeline — record this as a process gap. Record the version and date of each SBOM compared. |
| 3.9a | Does the SBOM identify the assessed product itself, and its third-party components, with standardised product identifiers — Common Platform Enumeration (CPE), Package URL (purl), or SPDX `externalRef` of type `cpe23Type` / `purl`? | Record, for the top-level product component: the CPE identifier and any Package URL (purl) present in the SBOM, and the SBOM field in which each is declared. If neither is present for the top-level product, this is a finding — without a standardised identifier the product cannot be correlated with CVE feeds (e.g., the NIST National Vulnerability Database) or with the [Certified Products & Services](/wg/pqc/pqcmm/products/) registry. Sample at least five third-party components from the SBOM and record whether each carries a CPE or purl. Components with neither identifier should be noted; widespread absence indicates an inventory that cannot be machine-correlated with vulnerability data. |

### Crypto Agility

| # | Question | Assessment guidance |
|---|---|---|
| 3.10 | How does the product support algorithm updates without major architectural redesign? Demonstrate that at least two distinct algorithms can be selected for the same cryptographic role through configuration. | Request a design document or written architectural description of the crypto agility mechanism. Record: document title, version, date. Ask the vendor to identify, for at least one role (e.g., signing, key exchange), the two algorithms that can be selected and the configuration step to switch between them. The two options must be different algorithms or different constructions (e.g., pure-PQC vs. hybrid) — selecting between parameter sets of the same algorithm (e.g., ML-KEM-768 vs. ML-KEM-1024) does not satisfy this question on its own. Ask the vendor: "If ML-KEM-768 were deprecated tomorrow, walk me through exactly what would change in this product and what the customer impact would be." Record the answer with its source (document reference or "verbal, unconfirmed"). A credible answer names a specific mechanism — configurable cipher suite list, algorithm policy file, algorithm registry — not "we would release a patch". |
| 3.11 | Are cryptographic algorithm identifiers and parameters externalised from hard-coded values? | Ask to see the specific configuration file, policy document, or API that controls algorithm selection. Record the file name, format, and a sample of relevant content (which algorithm identifiers appear). Confirm by asking: "Can you change the algorithm for TLS key exchange without rebuilding the product?" Record the answer and whether the assessor was able to verify it in a test environment. Hard-coded algorithm names requiring a full rebuild are a finding. |
| 3.12 | Has the vendor executed or simulated a controlled algorithm transition for at least one feature? | Request written documentation: what was changed, the test environment, the test procedure, and the outcome. Record document title, version, and date. A verbal claim that a transition was tested without any written record is flagged as "vendor-stated, not documented". A documented proof-of-concept with a test procedure and result is strong evidence — note whether the procedure is reproducible by an independent assessor. |

### Key Lifecycle and Deprecation

| # | Question | Assessment guidance |
|---|---|---|
| 3.13 | Which algorithms protect the keys (KEKs, key-wrapping keys, root keys) used by the product itself — not only the keys exchanged with peers? | Cryptographic agility for traffic algorithms is undermined if the keys protecting them are wrapped with classical algorithms vulnerable to a future quantum attacker. Record each KEK / key-wrapping role with: algorithm, parameter set, key size, and whether it is classical or quantum-safe. A product that exchanges traffic with ML-KEM but wraps long-lived keys with RSA-2048 must document this explicitly — it is a finding for any data with long confidentiality requirements. |
| 3.14 | Does the product use random number generation appropriate for cryptographic key material? | Record the DRBG / PRNG used (name, source, e.g., NIST SP 800-90A AES-CTR-DRBG, OS-provided `getrandom`/`/dev/urandom`, hardware RNG), the seed length, and the source of entropy. Modern DRBGs with 256-bit seeds are considered quantum-resistant for symmetric key generation; record the configured seed strength. A product that derives PQ key material from a DRBG seeded with fewer than 256 bits is a finding. |
| 3.15 | Has the vendor published an algorithm deprecation policy describing how it responds to a vulnerability or parameter-set deprecation in an algorithm the product depends on? | Record the policy document URL, version, and date. The policy should state: how the vendor monitors algorithm developments; the maximum time between a credible deprecation event and a vendor advisory; and the mechanism used to remove or disable the affected algorithm. Absence of any published policy is a finding. The detail need not match a security-incident response process but must be a written commitment. |

### Harvest-Now-Decrypt-Later (HNDL) Exposure Register

| # | Question | Assessment guidance |
|---|---|---|
| 3.16 | Does the vendor maintain a written HNDL exposure register identifying data flows handled by the product that carry long-lived confidentiality requirements? | Request the register. Record document title, version, and date. Each entry should identify: the data class (e.g., "customer-uploaded documents", "signed audit logs"), the expected confidentiality lifetime (years), the algorithm currently protecting it, and whether it is quantum-safe. A register that lists no HNDL-exposed data despite the product handling long-lived data is a finding — record the gap and the vendor's justification. |

## Evidence Checklist

The items below are a level-specific summary of the artefacts a vendor should be able to produce. They can serve as a concise request list for an assessor, or as a self-assessment reference for a vendor preparing evidence before a formal assessment. The detailed requirements and acceptance criteria for each item are in the assessment questions above. All artefacts from [Level 1](/wg/pqc/pqcmm/levels/1-initial/#evidence-checklist) and [Level 2](/wg/pqc/pqcmm/levels/2-basic/#evidence-checklist) remain required.

- Cryptographic inventory document or summary (publicly available or under NDA), covering every category in the Cryptographic Inventory Taxonomy.
- SBOM in SPDX or CycloneDX format for the current release, with Common Platform Enumeration (CPE) and/or Package URL (purl) identifiers recorded for the top-level product (and for third-party components where available).
- Documentation describing crypto-agility mechanisms and how to use them, naming at least two algorithms selectable for the same role.
- A list of non-quantum-safe features with their documented risk status.
- Algorithm deprecation policy.
- HNDL exposure register.
- Identification of the DRBG / RNG used for cryptographic key material and its seed strength.

## Suggested Procurement Actions

- Request the SBOM and verify cryptographic library versions against known vulnerabilities.
- Assess whether crypto-agility mechanisms cover the use cases most relevant to your integration.
- Use the non-quantum-safe feature register as input into your own cryptographic risk register.
- Consider requiring Level 3 for any system involved in long-term data archival, identity issuance, or critical infrastructure.

