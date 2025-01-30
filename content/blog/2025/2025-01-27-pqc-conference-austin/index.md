---
title: "Key Takeaways of the PQC Conference in Austin"
summary: |
  Over two days of intensive programming, experts delivered compelling presentations and engaged in insightful panel discussions, both in plenary sessions and concurrent breakout tracks. This year, the focus shifted decisively from theoretical exploration to concrete, actionable steps for implementing quantum-safe cryptography. The key takeaway was clear: delay poses the greatest risk, and immediate action is essential to achieve quantum resilience.
authors:
- Paul van Brouwershaven
date: 2025-01-30T07:00:00+00:00
keywords: [PQC, Post-Quantum Cryptography, Conference, Austin, Texas] 
tags: [PQC, Post-Quantum Cryptography, Conference, Austin, Texas]
---

**The 2025 PKI Consortium Post-Quantum Cryptography (PQC) Conference in Austin marked a milestone, attracting an unprecedented 2,191 registrants. While 250 attendees gathered in person at the University of Texas at Austin, the conference embraced a hybrid format, with many more joining remotely via the live stream.**

Over two days of intensive programming, experts delivered compelling presentations and engaged in insightful panel discussions, both in plenary sessions and concurrent breakout tracks. This year, the focus shifted decisively from theoretical exploration to concrete, actionable steps for implementing quantum-safe cryptography. **The key takeaway was clear: delay poses the greatest risk, and immediate action is essential to achieve quantum resilience**.

{{< carousel "photos/*" >}}  

## Key Takeaways

### 1. Urgency of Migration

- Transitioning to PQC is not optional. Quantum computers capable of breaking current cryptography are a growing risk, and **data that must remain secure for another decade should already be migrating to PQC**.
- **"The best thing we can all do is start work now”**, said Andrew Regenscheid (NIST). Organizations must begin transitioning as the window to act is closing.
- Bill Newhouse (NCCoE) emphasized: **"Time is better spent migrating from RSA-2048 to PQC, not RSA-3072 or 4096"**.
- With NIST releasing its first PQC-certified algorithms (ML-KEM, ML-DSA, SLH-DSA) and setting a 2035 deadline for quantum resilience in U.S. national security systems, organizations must accelerate migration efforts.
- NSA (Morgan Stern) highlighted hardware lifecycles, stating: **"Hardware has a 10-year lifespan, so action is required now to ensure future interoperability and security"**.

### 2. Hybrid Cryptography and Cryptographic Agility

- Hybrid cryptographic solutions, combining classical and post-quantum algorithms, offer a practical transition pathway but come with challenges. 
  - **"Adding hybrid modes will slow transitions due to new standards and validations”**, warned Morgan Stern (NSA).
- Cryptographic agility is essential for futureproofing systems. Lily Chen (Mathematician, NIST Fellow) is drafting a framework to support this flexibility.
- Tools like the NCCoE's multi-dimensional migration guide aim to help organizations navigate complexities and maintain agility during PQC transitions.

### 3. Discovery and Inventory

- **"Discovery and inventory of cryptographic assets is a no-regret first step”**, emphasized Alessandro Amadori (TNO).
- Discovery efforts have revealed startling statistics: **250K cryptographic keys on macOS devices and 369K on Windows 10**, shared Alexander Loew (DWH).
- Cryptographic Bills of Materials (CBOMs) and Software Bills of Materials (SBOMs) were proposed as governance tools to track and manage cryptographic assets, a sentiment echoed by Roman Cinkais and Bill Newhouse.

### 4. Internet Readiness and Technical Challenges

- **"The internet is not yet ready for PQ certificates”**, stated Luke Valenta (Cloudflare).
- Protocol ossification, larger signature sizes, and limited certificate chain support present barriers. For example, every extra 1KB in a TLS handshake increases response time by 1.5%, impacting user experience.
- Valenta noted that **"Two PQC migrations are needed for the internet: key agreements (urgent) and signatures (more complex)"**. While post-quantum key agreement has been integrated into browsers, signatures remain a challenge.
- Migration complexities include DNSSEC, fragmented ClientHello messages, and hardware constraints in handling large keys and signatures.
- **Panos Kampanakis and Mila Anastasova's presentation, "How much will ML-DSA Signatures affect Web Metrics after all?", presented a contrasting view, arguing that the impact of ML-DSA signatures on the actual browsing experience would likely be minimal for most users.** They acknowledged that ML-DSA signatures increase the size of TLS handshakes by approximately 15KB. However, they also demonstrated that web connections transport large amounts of content and the handshake is only a small portion of the overall transfer time. Their analysis of web page performance metrics of top websites indicated that an additional 15KB in the handshake would likely have a minimal impact on the user experience.
- **However, usage patterns for TLS vary significantly, which means it remains important to test specific use cases.** The impact of PQC can vary greatly depending on how connections are managed and how much data is transferred in each connection. While some web connections transfer large amounts of data, other connections transfer small amounts of data and could see more of a performance impact. Additionally, even when web content is transferred over a few large connections, many small, lean connections for things like tracking and ads might be affected more.

In summary, while Luke Valenta highlighted the significant challenges in migrating to post-quantum signatures, Kampanakis and Anastasova's work suggests that the impact on user experience may not be as severe as initially feared for some use cases, particularly when considering the larger amounts of data transferred over typical web connections. However, it remains important to consider that TLS usage patterns can vary significantly, and further testing and optimization efforts are needed to ensure a smooth transition to post-quantum cryptography across all applications and use cases.

### 5. Sector-Specific Insights

#### Financial Services 

- Jeff Stapleton (Wells Fargo) outlined how the X9 PKI standards are designed to be quantum-safe from the start, addressing use cases like ATMs and point-of-sale systems.
- Jaime Gómez García (Banco Santander) detailed a phased approach: 
  - **Wave 1**: Define capabilities and landscape (2025).
  - **Wave 2**: Prioritize transitions (2026–2029).
  - **Wave 3**: Clean up legacy systems (2029 onward).
#### Healthcare
Scott Stuewe (DirectTrust) leads an organization that oversees a large private PKI in the healthcare information exchange ecosystem, and is focused on ensuring that the community is prepared for the post-quantum transition.
The healthcare sector, while heavily regulated, also includes many non-compliant entities, presenting a challenge for broad adoption of post-quantum cryptography.
A new proposed rule making is focused on cyber security elements and also has a post-quantum element to it.
DirectTrust is creating roadmaps and testing mechanisms for its community to adopt post-quantum certificates as soon as they become available.
#### Telecommunications
Lory Thorpe (IBM and GSMA) is working with telecommunications organizations and governments to prepare for the post-quantum cryptography transition and crypto agility, which is critical to the digital society and economy.
The telecommunications sector is heavily regulated, and requires a high degree of coordination for post-quantum readiness.
The telecommunications industry is updating RFP requirements to manage the supply chain and ensure that vendors provide needed post-quantum capabilities.
#### National Security Systems (NSS) 

- NSA's CNSA 2.0 mandates ML-KEM-1024, AES-256, and ML-DSA-87 for National Security Systems, with a target for all systems to be quantum-resilient by 2035.

### 6. Technical and Operational Challenges

- Side-channel resistance in PQC remains a challenge, as noted by multiple speakers.
- Mike Ounsworth (Entrust) discussed the complexity of algorithm selection, urging organizations to consider security, performance, and bandwidth needs when adopting quantum-safe solutions.
- Operational technology (OT) systems often lack discovery tools, but Amadori stressed: **"Start with available tools—discovery is a critical first step"**.
- Alexander Loew shared concerns over legal restrictions on re-encrypting notarized documents, which complicates transitions to PQC.

### 7. Broader Considerations

- Scott Aaronson (UT Austin) provided a nuanced perspective on quantum computing, cautioning against reliance on theories like **"quantum mechanics being wrong"** for security. Instead, he emphasized applications like material simulation and the billions being invested globally in quantum technologies.
- PQC transitions act as stress tests on existing systems, exposing flaws and enabling organizations to build more resilient architectures.

## Concluding Messages

The 2025 PQC Conference reinforced critical points for all stakeholders:

- **Act now.** Waiting for quantum computers is no longer an option; the groundwork must begin immediately.
- **Prioritize critical areas.** Focus on key agreements and cryptographic inventories as the first steps.
- **Collaborate and share lessons.** The transition to PQC requires a united effort across industries, governments, and academia.
- **Embrace agility.** Cryptographic agility will be the cornerstone of adapting to future cryptographic needs.

Let’s continue working together to secure our digital future.

## Conference Materials and Engagement Opportunities  

The **slides from the conference** are now available on the [conference page](/events/2025/pqc-conference-austin-us/). Additionally, the **first recordings are on our [YouTube channel](https://www.youtube.com/@PKIConsortium)**—subscribe to be notified as more are uploaded and processed.  

We value your feedback! Please share your thoughts via our [attendee survey](https://forms.gle/sfSL1puJ4TZ1zZwM6). Your input will help shape future conferences.  

## Gratitude to Our Community  

A heartfelt thank you to our **sponsors**, **speakers**, and **organizers**. Your support and contributions were instrumental in making this event a success. Together, we are building a more secure and quantum-resilient future.  

{{< sponsors sponsoring="Post-Quantum Cryptography Conference Austin 2025" level="all" height="20" max-width="60" rows=true >}}

