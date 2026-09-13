---
date: 2026-02-24T08:00:00Z
title: Post-Quantum Cryptography Conference - December 1 - 3, 2026 - Amsterdam, The Netherlands
linkTitle: Overview
summary: |
  The PKI Consortium will host the next Post-Quantum Cryptography (PQC) Conference in Amsterdam. Over three days, we will bring together public- and private-sector leaders, standards bodies, and implementers to share practical migration experience and to accelerate real-world post-quantum readiness.

aliases:
 - /pqcc

layout: single
outputs:
 - html
 - og-card
 - event-data
# TODO: Resolve the og-card<>event-overlays random display conflict 
#  - event-overlays
#  - event-session
#  - event-speakers
#  - event-speakers2
#  - event-agenda

cascade:
  params:
    heroImage: amsterdam-nl.png
    heroDescription: December 1 - 3, 2026 - Amsterdam, The Netherlands | Hybrid
    heroSponsorLevel: 5
    sectionNav: true
    sponsoring: "Post-Quantum Cryptography Conference Amsterdam 2026"

params:
  eventType: conference
  eventDate: 2026-12-01T00:00:00Z
  eventDuration: 3
  heroHeight: 65vh
  heroButton:
    label: "Secure your seat →"
    link: register/
  heroTitle: Post-Quantum Cryptography Conference

data:
  name: Post-Quantum Cryptography Conference
  timezone: Europe/Amsterdam
  draft: true
  location: Amsterdam, The Netherlands
  attendanceMode: https://schema.org/MixedEventAttendanceMode
  registrationUrl: register/
  participationUrl: propose/
  sponsorshipUrl: sponsors/

  # Locations with sessions in parallel ---------------------------------------
  # Notes:
  # - Plenary runs in the main red hall (~800 capacity). LIVE STREAMED.
  # - The parallel track runs in the blue (former main) hall (~270 capacity). LIVE STREAMED.
  # - During theme blocks, one of the two livestreamed halls leads (hosts the
  #   intro, a featured breakout, and the synthesis panel); the other runs a
  #   featured breakout in parallel.
  # - Rooms A–E are small-group breakout rooms, NOT livestreamed. Sessions are
  #   moderated by a subject matter expert and capped at ~30 participants.
  # - Remaining rooms: quiet work/call space, organizer office, up to 2 sponsor suites.
  locations:
    order: [plenary, blue_hall, room_a, room_b, room_c, room_d, room_e]
    plenary:
      name: Red hall
      color: black
    blue_hall:
      name: Blue hall
      color: navy
    room_a:
      name: Room A
      color: teal
    room_b:
      name: Room B
      color: teal
    room_c:
      name: Room C
      color: teal
    room_d:
      name: Room D
      color: teal
    room_e:
      name: Room E
      color: teal

  # Speakers ------------------------------------------------------------------
  # Speakers of accepted sessions who have confirmed their participation.
  speakers:
    - name: Paul van Brouwershaven
      title: Chair PKI Consortium and CEO of Digitorus
      bio: |
        Paul van Brouwershaven is a distinguished leader in cybersecurity with over two decades of experience specializing in Public Key Infrastructure (PKI). He is the owner and CEO of Digitorus and chairs the PKI Consortium and leads its Post-Quantum Cryptography (PQC) Working Group, driving collaboration and innovation in digital trust and cryptographic agility.
      social:
        linkedin: https://www.linkedin.com/in/pvanbrouwershaven/
        x: https://x.com/vanbroup
        github: https://github.com/vanbroup

    - name: Albert de Ruiter
      title: Vice Chair PKI Consortium and Policy Authority PKI Dutch Government (Logius)
      bio: |
        Albert de Ruiter operates the Policy Authority at Logius, the digital government service organization of the Netherlands. He is also a member of the QvC (Quantum Secure Cryptography) working group of the Dutch government, a board member of HAPKIDO, and the Vice Chair of the PKI Consortium.

    - name: Sven Rajala
      title: Vice Chair, PQC Working Group, PKI Consortium and Deputy PKI Officer, Keyfactor
      bio: |
        Sven is an award-winning cybersecurity consultant with over 19+ years of experience in PKI, automation of PKI and signing solutions, and containerized deployments. Sven’s career spans both the private sector and federal government, where he has helped organizations design, modernize, and secure their digital trust infrastructure.
        
        Recognized for his subject matter expertise in PKI and DevSecOps, he is often invited to lead client discussions, presentations, and technical seminars on EJBCA, PKI architectures, and automation best practices.
        
        Sven also hosts The Key Master series by Keyfactor, featured on the Keyfactor Developers YouTube channel, where he shares insights and interviews to help the PKI community deepen its technical knowledge.
      social:
        linkedin: https://www.linkedin.com/in/international-pki-man-of-mystery/
        github: https://github.com/svenska-primekey

    # --- Accepted CFP speakers (confirmed) ------------------------------------

    - name: Thom Wiggers
      title: Senior Cryptography Researcher, PQShield
      bio: |
        Thom obtained his PhD in applied cryptography with distinction from Radboud University, Nijmegen, The Netherlands. He is an expert in using the different characteristics of post-quantum schemes (KEM and signatures) to optimize the performance of protocols, and balancing trade-offs in protocol flow, runtime and bandwidth requirements. In his research, he has extensively explored how post-quantum cryptography can be integrated into real-world protocols, most notably TLS, but also WireGuard and Signal Messenger. Putting academic work into practice, Thom also contributes by participating in standardization efforts in the IETF, including co-chairing the PKI, Trees and Logs (PLANTS) Working Group that is working on modernizing the WebPKI with Merkle Tree Certificates. Thom also presents on and publishes thought leadership, such as the acclaimed PQC Digital Signatures Zoo.
      website: https://thomwiggers.nl

    - name: Abdel Fane
      title: Co-Founder, CryptoServe
      bio: |
        Abdel Fane is co-founder of CryptoServe and co-creator of QRAMM, the Quantum Readiness Assurance Maturity Model, presented at DEF CON 2025. He led the cross-ecosystem cryptographic census of 2.8 million packages presented in this session, building the scanning methodology and 357-library classification catalog from the ground up. He has 20 years of security experience across healthcare, financial services, and government, including engagements with Booz Allen Hamilton, Protiviti, Allstate, and the U.S. Department of Veterans Affairs. He holds a Master's in Cyber Forensics and Security, and is Executive Director of CyberSecurity NonProfit, a 501(c)(3) with 13,000+ members across 16 global chapters.
      social:
        github: https://github.com/thebenignhacker

    - name: Rumen Doynov
      title: Assistant Professor, Technical University of Sofia
      bio: |
        Rumen is an engineer and researcher working at the intersection of mechatronics, telecommunications, and next-generation cybersecurity, focused on bridging emerging cryptographic standards and their practical application in Industrial IoT (IIoT) and industrial communication systems. He is currently engaged in applied work on Post-Quantum Cryptography, centered on the real-world deployment of PQC within complex network architectures, including hybrid TLS 1.3 and end-to-end post-quantum mutual authentication frameworks.
      social:
        linkedin: https://www.linkedin.com/in/rumen-doynov-2041851b3/

    - name: Alexander Shestakov
      title: Researcher, Technical University of Sofia
      bio: |
        Alexander is a software and infrastructure engineer focused on building secure architectures and adapting networks for post-quantum standards. He recently graduated from a specialized technical high school in Bulgaria with a professional degree in System Programming, and continues his engineering studies at the Technical University of Sofia (Faculty of Telecommunications).
      social:
        linkedin: https://www.linkedin.com/in/shestakov-dev
        github: https://github.com/shestakov-dev

    - name: Parnashree Saha
      title: Security Architect, Encryption Consulting

    - name: Kim Nguyen
      title: SVP Innovations, Bundesdruckerei GmbH
      bio: |
        Kim Nguyen studied mathematics and physics at the universities of Göttingen, Cambridge (UK) and Essen. In 2001 he was awarded a PhD for his work on the connections between algebraic number theory and the security of discrete logarithms on elliptic curves.
        His first job was with the Crypto Competence Center of Philips Semiconductors (later NXP). In 2004 he joined Bundesdruckerei in Berlin, Germany, where he took over responsibility as the project lead for the digital part of the new digital passport and ID card. From 2012 to 2023 he headed D-Trust, the qualified trust service provider of the Bundesdruckerei Group, as Managing Director, and from 2018 to 2023 he also headed the Business Unit Trusted Services. In 2015 he was awarded the title of Fellow. As of 2024 he heads the Innovations department of Bundesdruckerei, focusing on digital identity, quantum technologies, cryptography, AI and data.

    - name: Jan Klaußner
      id: jan-klaussner
      title: Senior Product Architect, Bundesdruckerei GmbH
      bio: |
        Jan Klaußner is Senior Product Architect at Bundesdruckerei in Berlin with more than two decades of experience in security engineering focusing on innovative solutions for digital identity and trust services. In his current work, he develops and evaluates prototypes for quantum safe public key infrastructures and hybrid post quantum cryptography deployments in real world environments. Jan is actively involved in standardization efforts in IETF, ISO and ETSI on hybrid PQC schemes for Internet PKI and smart card ecosystems. He regularly shares insights at international conferences and industry events.

    - name: Ricardo Agustin Toledo Mañani
      id: ricardo-agustin-toledo-manani
      title: CTO, Quantum Chain PTE Ltd.
      bio: |
        Ricardo Toledo is CTO at Quantum Chain PTE Ltd., where he works on post-quantum blockchain infrastructure, wallet architecture, and transaction-signing migration from classical cryptography toward post-quantum schemes.
        His background spans aerospace ground-segment systems, railway signalling, secure communications, and distributed software architecture. At CAF Signalling he worked on key management and maintenance solutions for railway signalling systems, including KMS/KDC-related architectures, signalling communications, and integration with on-track hardware. At GMV he worked on telemetry and monitoring systems for ground equipment, control-centre integration, and the modernization of legacy systems toward microservices-based architectures.
        Ricardo's current work focuses on the practical engineering challenges of post-quantum migration, including key lifecycle design, wallet-based authorization, transaction validation, backward compatibility, and secure infrastructure for regulated digital asset systems.

    - name: Jelizaveta Vakarjuk
      title: Junior Researcher, Cybernetica AS
      bio: |
        Jelizaveta Vakarjuk is a junior researcher at Cybernetica and an industrial PhD student at Tallinn University of Technology. Her research focuses on post-quantum cryptography, privacy-preserving cryptography, and the security of voting systems. Her main research is on post-quantum digital signatures, but she also focuses on the aspects of migration to post-quantum cryptography, being one of the authors of the Estonian PQC migration roadmap.

    - name: Nikita Snetkov
      title: Junior Researcher, Cybernetica AS

    - name: Wilko Wenzel
      title: Solution Architect, Siemens AG
      bio: |
        Wilko Wenzel is a Lead Architect for PKI Services at Siemens IT, leading the design and evolution of enterprise trust and cryptographic services. His expertise spans PKI, digital identities, certificate lifecycle management, smart card technologies, and HSM-based security, with a focus on building resilient and scalable trust infrastructures for a global enterprise. Beyond traditional PKI, he is passionate about crypto agility, post-quantum cryptography, AI, and DevOps, exploring how automation and emerging technologies can shape the future of enterprise security services.

    - name: Yvan Vanhullebus
      title: Technical Leader R&D, Stormshield

    - name: Blair Canavan
      title: Director, Alliances - PKI and PQC Portfolio, Thales Group
      bio: |
        Blair has over 35 years of experience in cybersecurity sales, marketing, and business development. His career began with Symantec, where he developed his expertise in cybersecurity and cryptography, followed by key roles at startups such as Chrysalis-ITS (Thales), Titus (Fortra), Black Duck (Synopsys), InfoSec Global (Keyfactor), and Crypto4A. In 2019, Blair was recruited back to Thales as part of the Global Technology Alliances team, where he leads the curation of the PKI and Post-Quantum Cryptography (PQC) alliances portfolio. An avid presenter and startup consultant, Blair is a recognized contributor to the PQC industry and the founder of Thales' PQC Palooza, held annually at the RSA Conference. He holds an Honours BA from the University of Waterloo and Wilfrid Laurier University in Waterloo, Ontario, Canada.

    - name: Jaime Gómez García
      id: jaime-gomez-garcia
      title: Global Head of Cryptography and Quantum Threat Program, Santander Digital Services
      bio: |
        Jaime Gómez García is a recognized expert in quantum security, with an extensive professional background in the financial sector. He is known for advancing strategic awareness, industry coordination, and practical adoption of quantum-safe cryptography, helping organizations and critical infrastructures prepare for the transition to the quantum era. His influence has been recognized through multiple distinctions, including inclusion in Quantum Security 25: The Top 25 Most Influential People in Quantum Security (2026), the 2025 Quantum Leap Award from Keyfactor, and recognition as LinkedIn Top Voice (2024-2025) and Quantum Top Voices (2022-2024). Jaime serves as the Global Head of the Santander Quantum Threat Program and Chair of the Europol Quantum Safe Financial Forum.

    - name: Laima Jančiūtė
      id: laima-janciute
      title: Independent Researcher
      bio: |
        Until very recently, Laima Jančiūtė was affiliated with the University of Amsterdam, where for three years she researched the governance of the quantum-safe transition. Laima holds a PhD from the University of Westminster with a thesis on the policy process of adoption of the GDPR, examining the actors and factors that shaped the formulation of this major piece of legislation. She has a background in political science and public administration. Her research interests revolve around privacy and data protection, fundamental rights, policies for ICT, the history and philosophy of technology, EU politics and governance, and international relations. She has held various research and teaching positions at different universities.

    - name: Tobias Bojesen
      title: GTM Director, Cryptomathic

    - name: Guillaume Forget
      title: EVP Product Line Management, Cryptomathic
      bio: |
        Guillaume Forget is Executive Vice President, Product Lines at Cryptomathic, where he leads product strategy and direction across the company's portfolio of cryptographic and digital trust solutions.
        With more than 20 years of experience in electronic signatures, remote signing, and cryptographic trust services, Guillaume is a recognised industry leader in the e-signature space. He also serves on the Executive Committee of the Cloud Signature Consortium, contributing to the development and adoption of open standards for cloud-based digital signatures.
        His work focuses on helping organisations design secure, scalable, and standards-based trust architectures that can support evolving requirements, including crypto-agility, governed cryptographic services, and post-quantum transition readiness.

    - name: Cristof Kaufmann
      title: PQS Transformation Lead, PostFinance AG
      bio: |
        Cristof Kaufmann is the PQS Transformation Lead at PostFinance, where he drives the strategic advancement of Post Quantum Safety. As a mathematician with a focus on cryptography and security, he shapes the transition to quantum-secure solutions, thereby strengthening the future resilience of financial infrastructure. His work combines technical expertise with organizational transformation.

    - name: Thomas Maes
      title: Project Manager, PostFinance AG
      bio: |
        Thomas Maes is CEO of Illutas GmbH and a project and transformation lead at PostFinance, where he has spent the past eight years supporting the bank's strategic digital transformation programme. His work there spans post quantum safety, crypto inventories, PCI compliance and cybersecurity, giving him direct, practical experience of what it takes to future-proof a major financial institution's security posture. Before founding Illutas, Thomas held technology leadership roles at Swisscom, Alstom, and CSC, and earlier in his career worked as a senior consultant at Deloitte, Arthur Andersen and KPMG. He holds an MSc from Cranfield University and is based in the Greater Bern Area, Switzerland.

    - name: Dave Butcher
      title: Senior Security Consultant, Entrust

    - name: Louise Davey
      title: President, LDIQ
      bio: |
        Louise Davey is a Business Transformation Architect and Leader specializing in organizational readiness for emerging technologies. She helps large institutions develop new operational capabilities, protect against systemic risk, and strengthen data and technology governance. With 30+ years of executive and advisory experience in large, complex organizations, Louise translates advanced technological concepts (data, cybersecurity, AI, quantum) into measurable business outcomes, resilience, and agility. A former CTO and COO, an active board member and advisor, with an M.Sc. in Physics from McGill, she bridges two worlds: engaging deeply with scientists and engineers on technical concepts, and translating urgency into strategic implications and actions for CEOs, boards, and regulators. She is the author of "Quantum How: What every board member and executive needs to know to lead in the quantum era" and a member of the PKI Consortium.
      website: https://ldiq.ca/
      social:
        linkedin: https://www.linkedin.com/in/louisedavey/

    - name: Mike Ounsworth
      title: Open source maintainer, Bouncy Castle / OpenSSL
      bio: |
        Mike Ounsworth is a software security architect, cryptographer, and cryptographic protocol designer. He is deeply involved in the Post-Quantum transition, particularly in re-designing IETF networking protocols to accommodate the new PQC algorithms, dual-algorithm hybrids, and mechanisms to ease migration barriers. Mike is the founder of Cryptic Forest Software, Adjunct Professor at the Pôle d'expertises en cybersécurité (Cybersecurity Expertise Centre) at the université de Sherbrooke, and lead maintainer of the Bouncy Castle Rust cryptographic library.
      social:
        github: https://github.com/ounsworth

    - name: Elmer Lastdrager
      title: Research Engineer, SIDN Labs
      bio: |
        Dr.ir. Elmer Lastdrager works as a Research Engineer for SIDN Labs, the research team of SIDN, the operator of the .nl top-level domain. He looks at the challenges in the application of post-quantum cryptography for the DNS.
      social:
        linkedin: https://www.linkedin.com/in/elmerlastdrager/
        github: https://github.com/elmerlastdrager

    - name: Fred Roos
      title: Security Architect, ING
      bio: |
        Fred Roos is a Security Architect in the Global CISO team of ING. For more than 20 years he has been closely involved with PKI, key management, and applied cryptography within ING, combining operational excellence and ongoing developments with strategic approaches and a focus on improving ING's security posture and compliance.
      social:
        linkedin: https://www.linkedin.com/in/fred-roos-8978488/

    - name: Lory Thorpe
      title: Quantum Safe Strategy Advisor, IBM
      bio: |
        Lory Thorpe is an executive technology leader and board advisor with more than 20 years of experience shaping the strategy, commercialization, and adoption of emerging technologies across global industries. Her expertise spans advanced connectivity and communication, quantum readiness, cybersecurity, and deep tech. As a Senior Strategy Advisor within IBM, Lory leads the Quantum Safe agenda for industries, helping organizations prepare for the risks and opportunities of the quantum era. She is the Chair of the GSMA Post Quantum Telco Network Task Force, the first global telecom industry forum dedicated to post-quantum cryptography adoption.

    - name: Manfred Rieck
      title: Head of Quantum Tech / Co-Founder, Deutsche Bahn / Federal Quantum Alliance
      bio: |
        Manfred Rieck is Co-founder of the German Federal Quantum Alliance, a partnership of government-owned organizations and federal authorities including Deutsche Bahn/DB Systel, Bundesdruckerei, the Federal Office for Information Security (BSI), the German Federal Intelligence Service (BND), the Federal Employment Agency (BA), the German pension insurance, and BWI, the IT service provider for the German Armed Forces. The group focuses on the progress of quantum computing, quantum sensing, and quantum cybersecurity (PQC, QKD), acting as a think tank for the German government and supporting the structured introduction of PQC in government and industry. Manfred has worked in IT departments for more than 20 years in senior management positions at Deutsche Bahn, IBM, and BASF.

    - name: Kiruthiga Chandrasekaran
      title: Vice President, Jefferies

    - name: Tim Callan
      title: Chief Compliance Officer, Sectigo

    - name: Joachim Vererfven
      title: Solutions Engineer, Proximus

    - name: Luke Ibbetson
      title: Group R&D Director, Vodafone Group
      bio: |
        Luke Ibbetson leads the Vodafone Group Research and Development organisation, fostering the adoption of disruptive and emerging technologies for the benefit of customers, efficiency and growth. A telco industry professional with 30 years of experience, Luke is currently shaping Vodafone's thinking on Quantum technology, 6G, non-terrestrial networks, vehicle autonomy and advanced AI/ML. Luke is Chair of the Next Generation Mobile Networks (NGMN) Board Strategy Committee, Vice Chair of GSMA Post Quantum Telco Networks Task Force, and Chairman of the TechWorks Board and serves as main Board member for the 5G Automotive Association (5GAA), AST Space Mobile, and several venture backed technology companies. Luke is a proud pioneer of low power wide area IoT and a passionate supporter of innovative thinking.

    - name: Thalia Laing
      title: Principal Cryptographer and Security Researcher, HP Security Lab
      bio: |
        Thalia Laing is a Principal Cryptographer and Security Researcher in HP Security Lab, where her work focuses on applying cryptography to security-critical systems and the migration of products to quantum-resistant cryptography. She has played a leading role in the design and deployment of quantum-resistant firmware integrity protections for commercial endpoint devices. Thalia holds a PhD in Cryptography from the Information Security Group at Royal Holloway, University of London.

    - name: Antonio Javier Cabrera Gutierrez
      title: Staff System Architect, Infineon Technologies AG
      bio: |
        Antonio Javier Cabrera Gutierrez received his B.Eng. and M.Eng. degrees in Computer Engineering from the University of Granada, Spain, and joined Infineon Technologies AG in Neubiberg, Germany, in 2019 as a Ph.D. candidate in collaboration with the University of Granada, researching secure and reliable communication protocols in Industrial IoT networks. Since earning his Ph.D. in 2023, he has worked as a Security Architect for the TPM in the Edge Systems division, where he drives product requirements and innovations in collaboration with customers and standardization bodies, including the Trusted Computing Group (TCG). In TCG, he chairs the Internet of Things Work Group, extending TCG security standards and technologies into resource-constrained embedded devices.
      social:
        linkedin: https://www.linkedin.com/in/antoniojaviercabreragutierrez/

    - name: Olivier Couillard
      title: Technical Product Manager, Crypto4A Technologies Inc.
      bio: |
        Olivier joined Crypto4A eight years ago and has since contributed to nearly every facet of the HSM platform. His work spans from RNG design and entropy assessment to firmware development, key management applications, and even web UI implementation. In addition to his technical expertise, Olivier has collaborated with a wide range of customers and has been actively involved in the FIPS 140-2 and 140-3 certification processes.

    - name: Falko Strenzke
      title: Executive System Architect, MTG AG
      bio: |
        Dr. Falko Strenzke has been working in the field of IT security for over 20 years and has gained extensive experience in PKI, post-quantum cryptography (PQC), and applied cryptography. Today, he works at MTG AG as an Executive System Architect, where he is responsible for the technical aspects of PQC migration.
      social:
        linkedin: https://www.linkedin.com/in/falko-strenzke-008139314/

    - name: Roman Cinkais
      title: SVP Enterprise Products, OmniTrust
      bio: |
        Roman holds a master's degree in Mathematical Methods of Information Security from Charles University in Prague. He has over 15 years of professional experience in information security across financial, retail, banking, telco, and postal industries. Roman is a co-founder of 3Key Company (now OmniTrust Security following its 2026 merger with ISS), where he serves as SVP Enterprise Products. In 2021 he founded the open-source project originally named CZERTAINLY, today known as ILM, a cloud-native trust lifecycle management platform. Roman chairs the PKI Maturity Model Working Group at the PKI Consortium, where he leads work on the PKIMM Extension Framework.
      social:
        linkedin: https://www.linkedin.com/in/roman-cinkais/

    - name: Kennedy Nwup
      title: Principal Consultant, Afield AB
      bio: |
        Kennedy Nwup is Vice Chair of the PKI Consortium's PKI Maturity Model Working Group and author of the PQC Readiness Extension for PKI, the first published extension to the PKI Maturity Model Extension Framework.

    - name: Dayana Spagnuelo
      title: Scientist, TNO
      bio: |
        Dayana is a researcher specialised in information security and its interplay with regulatory requirements. Her research focuses on how current and future digital solutions should be tailored to accomplish principles of privacy and confidentiality.

    - name: Manon de Vries
      title: Researcher Applied Cryptography, TNO
      bio: |
        Ir. Manon de Vries is an Applied Cryptography researcher at TNO. She led the PQC Benchmarking project within the PCSI (Partnership for Cyber Security Innovation), and helped form the PCSI PQC Workgroup and the PQC Practitioners. She has over 10 years of practical security and cryptographic experience, including teaching courses on Cryptography and PKI.

    - name: Tim D Williams
      title: Chief Technology Officer, ProteQC PQC Advisory Limited
      bio: |
        Tim D Williams is a security architect and researcher with over thirty years' experience in applied cryptography, spanning public key infrastructure, digital certificates and signatures, key lifecycle management and hardware security modules across government, banking, energy and healthcare. He holds an MSc in Information Security Testing from Royal Holloway, University of London, an MBA from Quantic School of Business and Technology, is a Fellow of the BCS and Chartered IT Professional, a member of the Chartered Institute of Information Security, volunteer for ISC2 and Ukraine's National Academy of Internal Affairs and holder of certifications including CISSP-ISSAP-ISSEP-ISSMP. His current research, published via IEEE, Springer and SSRN (Elsevier), examines the post-quantum transition from cost, lifecycle, architectural and trust-anchor perspectives. He serves on the programme committee of the Cyber Science series of conferences, as CTO of PQC advisory start-up ProteQC and is pursuing a PhD by published works.

    - name: Xin Qiu
      title: Head of PKI Center and Security Solutions, Aurora Networks
      bio: |
        Dr. Xin Qiu is a cyber security expert specializing in public key infrastructure (PKI), embedded device security, software supply chain security, and post-quantum cryptography (PQC). She has generated a patent portfolio of over 100 assets worldwide. As Head of Aurora Networks' PKI Center and Security Solutions, she leads security product strategy, R&D, and operations, enabling large-scale, device-centric security deployments with global device manufacturers and network operators. Dr. Qiu is a frequent speaker at international cyber security and technology conferences.

    - name: Iván Fernández Mora
      id: ivan-fernandez-mora
      title: Cybersecurity Architect, Airbus
      bio: |
        Iván Fernández Mora is a Security Architect and Technical Lead with over 20 years of experience bridging the gap between complex engineering, advanced data analytics, and enterprise cyber resilience. Currently leading security architecture and encryption services at Airbus Aircraft, he specializes in designing robust frameworks that safeguard critical application data and infrastructure. His career is built on a strong foundation of fundamental physics and advanced simulations, which naturally evolved into building big data platforms and machine learning applications for fraud and insider threat detection.

    - name: Zsolt Makádi
      id: zsolt-makadi
      title: Senior Software Architect, Noreg
      bio: |
        Zsolt Makádi brings over 20 years of PKI expertise, specializing in certificate lifecycle management (CLM) system development and smart card infrastructure deployment.

    - name: Mark Cooper
      title: President and Founder, PKI Solutions
      bio: |
        Mark B. Cooper, president and founder of PKI Solutions, has been known as "The PKI Guy" since his early days at Microsoft. He has deep knowledge and experience in all things Public Key Infrastructure (PKI). PKI Solutions LLC provides consulting, training (including online training) and Gartner-recognized software for PKI Posture Management at enterprises, many of them Fortune 500 companies. PKI Solutions has led hundreds of PKI training sessions, including private training sessions, across the country and around the world. Cooper is an avid proponent of the SHAKEN/STIR global standard to end robocalls, which uses authentication and PKI to verify callers' identities. Prior to founding PKI Solutions, Cooper was a senior engineer at Microsoft, where he was a PKI and identity management subject matter expert who designed, implemented, and supported Active Directory Certificate Services (ADCS) environments for Microsoft's largest customers.

    - name: Sarah McCarthy
      title: SVP Cryptography, Citi

    - name: Itan Barmes
      title: Co-founder and Chief Strategy Officer, Qiz Security
      bio: |
        Itan Barmes is a quantum physicist turned cybersecurity strategist. After earning his PhD in quantum physics, he moved into cryptography and cyber risk, first as a senior manager at Deloitte and now as co-founder and Chief Strategy Officer of Qiz Security. For over a decade he has advised global enterprises on rebuilding their cryptographic foundations to withstand emerging quantum threats. At Qiz Security he drives the company's mission to make post-quantum resilience practical, bridging deep science with real-world implementation. Known for challenging assumptions, he blends scientific rigor, cybersecurity experience, and entrepreneurial drive to help organizations build digital trust for the quantum future.

    - name: Rouven Floeter
      title: Global Customer Cybersecurity Lead, Hitachi Energy
      bio: |
        Rouven Floeter is the Global Customer Cybersecurity Lead at Hitachi Energy and a Founding Member of the Hitachi Quantum Center of Excellence. With more than 26 years of cybersecurity leadership across IT and OT, he advises customers and industry leaders on cyber resilience, critical infrastructure protection, and quantum-safe transformation. Within the Quantum Center of Excellence, he supports initiatives related to post-quantum cryptography and the adoption of quantum-safe technologies. Previously, he led the development of the industry's first quantum-safe encryption solution for mission-critical communications.

    - name: Sjors Kasbergen
      title: IAM Specialist, Stedin and Chair of PQC Netbeheer Nederland
      bio: |
        Sjors Kasbergen is an IAM specialist at Stedin and chair of the Dutch grid operators' PQC expert group. He believes that digital trust has become so invisible that most people only notice it when it fails. His passion is helping organisations see the cryptography they rely on every day and understand why the transition to a quantum-safe future matters. By translating complex technical concepts into practical stories and decisions, he helps create the awareness needed to drive meaningful change.
      social:
        linkedin: https://www.linkedin.com/in/sjors-kasbergen/

    - name: Chris Bailey
      title: Board Chair, PKI Consortium

    - name: Chris Hickman
      title: Chief Security Officer, Keyfactor
      bio: |
        As Chief Security Officer at Keyfactor, Chris Hickman is at the forefront of advancing the company's position as a leader of digital trust security solutions in the technical landscape of cryptographic infrastructure and digital certificates. With extensive experience in smart card management systems, PKI design, and directory services, Chris is committed to integrating the voice of the customer into Keyfactor's platform to drive innovative solutions and accelerate digital trust in the evolving security landscape. He spearheads Keyfactor's post-quantum cryptography (PQC) strategies to support organizations in their quantum-readiness journeys. He remains an industry-wide trusted resource on enhancing digital trust through SaaS-delivered PKI solutions and certificate lifecycle automation software to support security teams of modern enterprises.

    - name: Ganesh Mallaya
      title: Global Field CTO, AppViewX

    - name: George Parsons
      title: Head of PKI Strategy, Palo Alto Networks

    - name: Marin Ivezic
      title: Founder and CEO, Applied Quantum
      bio: |
        Marin Ivezic has spent three decades leading national and large-enterprise IT/OT transformation programs of up to $500M, including turnarounds of failing ones. A former quantum entrepreneur, he has served as a Fortune Global 500 CISO and CTO and led global and regional cybersecurity practices at Accenture, IBM, and Big 4 firms. He is now founder and CEO of Applied Quantum, advising governments and enterprises on post-quantum migration, and writes the personal blog PostQuantum.com, which draws more than a million unique visitors a month.

    - name: Dmitry Belyavskiy
      title: Principal Software Engineer, Red Hat
      bio: |
        Dmitry has worked with OpenSSL code for 20+ years, the last 5+ of them at Red Hat, where he serves as an OpenSSL maintainer and OpenSSH co-maintainer. He is involved in the OpenSSL community as a distribution community representative on the OpenSSL Corporation Technical Advisory Committee.
      social:
        linkedin: https://www.linkedin.com/in/dmitry-belyavskiy-34b45494/
        github: https://github.com/beldmit

    - name: Stephan Ehlen
      title: Head of Division, Quantum-Safe Cryptography and Cryptographic Applications, Federal Office for Information Security (BSI)

    - name: Michael Osborne
      title: CTO IBM Quantum Safe
      bio: |
        Michael Osborne is an IBM Distinguished Engineer and the global CTO for IBM Quantum Safe. He leads the cryptographic research activities at the IBM Research Center in Rüschlikon, Switzerland. His current focus includes advancing new generations of advanced cryptography, such as those selected by NIST as the next generation of PQC algorithms. He also leads the development of methods and technologies to help organizations migrate to use new Quantum-Safe standards.

    - name: Antti Ropponen
      title: Executive Partner, Quantum Safe Transformation Services, IBM

    - name: Sudha Iyer
      title: Chief Engineer - PKI & Cryptography, Citi
      bio: |
        Sudha Iyer is Chief Engineer - PKI & Cryptography at Citi, an international expert and project leader for ISO smart contract security, a member of the ASC X9 Board of Directors, lead of the QSFF Prioritization stream, and a founding member of the FS-ISAC PQC Working Group.

    - name: Tomas Gustavsson
      title: Chief PKI Officer, Keyfactor
      bio: |
        Tomas Gustavsson is the chief public key infrastructure (PKI) officer at Keyfactor. He pioneered open-source public key infrastructure with EJBCA, now embraced by thousands of organizations. With a background in computer science, Tomas established EJBCA to fortify trusted digital identities globally. He advocates for cybersecurity through innovation, collaboration, and open-source principles.

    - name: Michele Mosca
      title: CEO, evolutionQ Inc.
      bio: |
        Michele Mosca is a co-founder and CEO of evolutionQ and a Professor of Mathematics at the University of Waterloo. He is widely recognized as a pioneer in quantum computing and a leading voice on the cybersecurity implications of quantum technologies. He is a co-founder of the Institute for Quantum Computing and a founding member of the Perimeter Institute for Theoretical Physics, and has helped lead international initiatives in quantum-safe security including the Open Quantum Safe project and the ETSI-IQC Quantum-Safe Cryptography Conference. He holds a doctorate in quantum computer algorithms from the University of Oxford.
      social:
        linkedin: https://www.linkedin.com/in/dr-mosca/

    - name: Zygmunt Lozinski
      title: Quantum Safe Networks, IBM
      bio: |
        Zygmunt's mission is to make the world's networks quantum safe. His research is on quantum risk in telecommunications, critical infrastructure, and national security. Zygmunt is one of the co-founders of the GSMA Post Quantum Telco Network Task Force and editor for its publications, and he works with governments on national PQC guidance. He has extensive experience in telecommunications, network cloud / NFV, edge computing, orchestration, and 5G security.

    - name: Vivian Ma
      title: Co-Founder and Chief Commercial Officer, CeQureX Technology Limited
      bio: |
        Vivian Ma, Co-Founder of CeQureX, is a pioneering ASEAN PQC migration leader with over 20 years of digital transformation experience. Serving as a core partner to regional cybersecurity authorities and premier healthcare alliances, she directs quantum-readiness strategies for sovereign government, Tier-1 financial and healthcare enterprises.

    - name: Mathias Schumacher
      title: Project Manager Innovation and Technology, NMWP Management GmbH
      bio: |
        After studying physics at RWTH Aachen, Mathias Schumacher worked as a software engineer and machine-learning and data-science developer in materials science before entering the field of technology and innovation management. At NMWP he is a project manager, both in EIN Quantum NRW, the quantum technologies network of the state of North Rhine-Westphalia, Germany, and in Q-PrEP, the all-European community project to foster PQC in the public sector. Besides PQC, his professional interests in these two roles cover quantum communication and computing, and all aspects of quantum that drive the development of technology and society.
      social:
        linkedin: https://www.linkedin.com/in/mathias-schumacher-22727121b/

    - name: Adrian Neal
      title: Senior Director and Global Lead for Post-Quantum Cryptography, Capgemini
      bio: |
        Adrian Neal, a two-time winner of the NATO Defence Innovation Challenge, is an internationally recognised cybersecurity and cryptographics expert, and currently holds the position of Senior Director and Global Lead for Post-Quantum Cryptography at Capgemini.
        While primarily advising governments, defence organisations and global multi-nationals on post-quantum readiness, he is also a cybersecurity advisor regarding Central Bank Digital Currencies (CBDC), particularly in respect to the social and economic risks from future post-quantum cryptographic instability.
        He is a graduate of Oxford University, from which he received a Master's degree in Software Engineering, and began his career at IBM in the mid 1980s, followed by a decade in the City of London, departing in 1998 for Zurich to join UBS Warburg as their first cryptographics expert while becoming a member of the International Association for Cryptologic Research (IACR).
      social:
        linkedin: https://www.linkedin.com/in/adrianneal/

    - name: Shahid Raza
      title: Professor and Research Director, University of Glasgow UK / RISE Sweden
      bio: |
        Shahid Raza is the Chair and Full Professor of Cybersecurity and the Director of Research at the School of Computing Science at the University of Glasgow, UK. Previously, Shahid served as the Director of the Cybersecurity Unit at RISE Sweden for eight years, where he established the unit as one of the largest technical cybersecurity groups in Sweden, conducting cutting-edge research on both fundamental and applied cybersecurity topics. He co-founded Cybercampus Sweden and leads its scientific activities as the Research Director. Additionally, he envisioned and founded the RISE Cyber Range and the Swedish Cybersecurity Research and Innovation Node. Shahid is an expert cybersecurity researcher; his scientific work, published in prestigious journals and conferences, has received over 8000 citations. He holds a Swedish Docentship title from Uppsala University, a PhD from Mälardalen University, and an MSc degree from KTH, all in cybersecurity.

    - name: Daniel Apon
      title: Director of Cryptography, Anduril Industries
      bio: |
        Daniel Apon is the Director of Cryptography at Anduril Industries. He previously was a Lead Cryptographer at the MITRE Corporation, working on advancing the broader industry's efforts in Post-Quantum Cryptography migration. Prior to that, he was a Cryptographer on the NIST PQC team during its PQC standardization process, where he was the NIST subject matter expert in lattice-based cryptography.

    - name: Bruno Couillard
      title: CEO & Co-Founder, Crypto4A
      bio: |
        Bruno Couillard is the Co-Founder and CEO of Crypto4A, a leader in quantum-safe cybersecurity and trusted cryptographic infrastructure. He works at the intersection of advanced cryptography, digital trust, and secure infrastructure modernization, helping organizations prepare for the transition to the post-quantum era.

    - name: Ted Shorter
      title: Chief Technology Officer, Keyfactor
      bio: |
        Ted Shorter is Chief Technology Officer at Keyfactor. Ted has worked in the security arena for over 24 years, in the fields of cryptography, application security, public key infrastructure, and software vulnerability analysis, including 10 years with the U.S. Department of Defense.

    - name: Evgeny Gervis
      title: CEO, SafeLogic
      bio: |
        Evgeny has two decades of experience in the cybersecurity field, spanning startups to large Fortune 500 organizations. Prior to joining SafeLogic, Evgeny spent 15 years at Cigital and then, post-acquisition, at Synopsys, responsible for the firm's software security solutions practice in the broader Mid-Atlantic region.

    - name: Akane Suzuki
      title: Chief Researcher, Hitachi, Ltd.
      bio: |
        Akane Suzuki is a Chief Researcher at Hitachi, Ltd., specializing in information security, electronic authentication, and digital identity. Leveraging hands-on experience in cryptographic migration for public key infrastructure during Japan's "2010 Cryptographic Algorithm Transition," Suzuki currently focuses on analyzing post-quantum cryptography (PQC) trends and designing migration approaches, and contributed to the CRYPTREC external evaluation report in FY2025, "Survey on Technical Trends in the Migration to Post Quantum Cryptography."

  # Agenda --------------------------------------------------------------------
  # Red hall (plenary) carries the strategic track, the blue hall the technical
  # track; rooms A-E are smaller breakout rooms. Sessions are 30 min, panels 45,
  # with one 60-min slot each morning. Lunch is 90 min and the two 30-min breaks
  # are deliberate networking windows. Slots still marked "To be announced" are
  # being filled as further proposals are accepted and speakers confirm.
  agenda:
    2026-12-01:
      - time: "08:00"
        title: Registration

      - time: "09:00"
        noTransition: true
        sessions:
          - title: Opening
            description: |
              Welcome to the 2026 PQC Conference. The chairs open the conference, set the agenda for the three days ahead, and invite some attending sponsors for a one-minute pitch (the only commercial message allowed at this conference).
            speakers:
              - Paul van Brouwershaven
              - Albert de Ruiter
            locations:
              - plenary

      - time: "09:30"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

      - time: "10:15"
        title: Break

      - time: "10:45"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: Post-Quantum Security of IPsec / IKEv2
            description: |
              IKEv2 is the key exchange protocol that drives IPsec, the enterprise workhorse VPN. In this talk, I will recap the standardization of extensions that allow us to use IPsec with post-quantum key exchange, and explain what features you need to turn on (or make sure to ask your suppliers for) to be secure against post-quantum adversaries, both for harvest-now decrypt-later and fully post-quantum adversaries. I will support these claims through a security analysis of IKEv2 and its extensions that we submitted to a major academic security conference.

              This talk is based on joint work with Benedikt Auerbach, Keitaro Hashimoto, and Shuichi Katsumata.
            speakers:
              - Thom Wiggers
            locations:
              - blue_hall

          - title: To be announced
            description: |
              Session details will be announced soon.
            durationMinutes: 105
            locations:
              - room_a
      - time: "11:45"
        sessions:
          - title: "Where the PQC Migration Actually Stands: A Cross-Ecosystem Census of 2.8 Million Packages"
            description: |
              The NIST 2030 deprecation deadline for quantum-vulnerable public-key algorithms is 1,386 days away as of March 2026. Every PKI operator, certificate authority, and security team needs to know how the software supply chain they depend on is responding. No cross-ecosystem measurement existed. We built one. This session presents findings from the first cross-ecosystem cryptographic census, scanning 2,809,479 packages across 11 package ecosystems including npm, PyPI, Go, Maven, crates.io, NuGet, and others. The results reveal the actual state of PQC adoption in the open-source supply chain that PKI infrastructure depends on. Of the 2.8 million packages scanned, 108,145 use cryptographic libraries. Among those, 21,332 depend on weak or deprecated algorithms such as MD5, SHA-1, DES, and RC4. Only 188 packages, or 0.17 percent of crypto-using packages, have any post-quantum cryptography dependency. PQC adoption is concentrated in 5 of 11 ecosystems, with crates.io accounting for 58 percent of all PQC-dependent packages. Six ecosystems show zero PQC adoption. Maven has the worst weak crypto rate at 51.6 percent.

              Beyond the headline numbers, the talk addresses the migration gap that matters most for PKI operators. Dependency-level scanning, the foundation of most software composition analysis tools, misses approximately 4 times the cryptographic surface area visible to source-level analysis. We validated this gap on 20 production projects and found that 30 percent of projects with active cryptographic code show zero dependency-level signal. For PKI operators conducting cryptographic inventories under NIST IR 8547 or OMB M-23-02, this means current tooling systematically undercounts exposure.

              Attendees leave with three actionable outcomes: the current state of PQC adoption in their language ecosystem with named libraries and migration paths; a reproducible census methodology they can apply to internal package registries and vendor assessments; and a clear understanding of why dependency scanning alone fails for cryptographic inventory and what to do about it.

              All scanning tools, the 357-library classification catalog, the full scan dataset, and a live dashboard are released open source.
            speakers:
              - Abdel Fane
            locations:
              - plenary

          - title: "Making ML-DSA Work for Machine-to-Machine mTLS: Field Notes from an End-to-End Post-Quantum PKI"
            description: |
              Most post-quantum migration programs have done the easy part - hybrid key exchange - and then hit a wall at authentication. Getting ML-DSA certificates working for real machine-to-machine identity, with a PKI that can issue, renew, and revoke them, is where timelines slip: the certificates are large, lifecycle tooling is immature, and almost no one has run mutual TLS where both sides authenticate with post-quantum credentials.

              This is a practitioner field report from an organization that has built and now operates exactly that - an end-to-end post-quantum machine-identity stack: an ML-DSA-65 CA hierarchy, post-quantum-only mutual TLS enforced at the edge, automated enrollment and short-lived issuance, and OCSP/CRL revocation that takes effect in real time. We share what it actually took, so teams planning the authentication phase of their own migration know what they are walking into.

              Attendees leave with: a realistic picture of the authentication half of PQC migration - what is production-ready today and what is still blocked on standards (IETF LAMPS composite certificates, post-quantum identity tokens); where ML-DSA certificate and signature sizes actually cause problems - handshake payloads, buffers, issuance throughput - measured against classical TLS 1.3; how to tell a genuinely post-quantum-only deployment from a post-quantum key exchange sitting in front of classical certificates, and how to verify it; a certificate-lifecycle model for machine identity - constrained enrollment, automated issuance, real-time revocation - and the operational decisions that matter; and a practical set of questions to put to your CAs, HSM vendors, and platform teams before committing to an approach.

              The session is for PKI, platform, and security teams responsible for the machine-identity and mTLS portion of their post-quantum migration. It assumes working knowledge of TLS 1.3 and certificate PKI; no prior post-quantum background is required.
            speakers:
              - Rumen Doynov
              - Alexander Shestakov
            locations:
              - blue_hall

      - time: "12:30"
        title: Lunch

      - time: "14:00"
        sessions:
          - title: "What Breaks Between Assessment and Implementation: Lessons from PQC Migration Programs Across Organizations"
            description: |
              Most PQC migration advice stops at the roadmap. This session picks up where the roadmap meets production, drawing on assessment and migration work across many organizations in different sectors and at different levels of maturity. The recurring lesson is that the same failure points show up again and again, and that the gap is between a clean assessment, a practical roadmap, and successful implementation.

              The talk follows the real arc of a program. It starts with discovery and assessment, including what cryptographic inventory consistently misses: statically linked libraries, keys embedded in firmware, proprietary protocols on operational networks, and cryptography buried inside third-party appliances. It then moves to the migration attempt and the things that broke in production. Hybrid and composite certificates issued into mutual TLS meshes triggered chain validation errors in older OpenSSL and JSSE clients. Handshake sizes grew large enough to fail through middleboxes and load balancers. Hardware security module gaps for composite key generation surfaced only under load. The session walks through the rollback decision and the redesign that held, which was a parallel PQC hierarchy rather than swapping roots in place.

              The second half connects engineering reality to assurance reality, because the same programs hit a second wall: producing evidence auditors accept. It maps what examiners actually request against NIS2, DORA, and the CRA, including CBOMs as Article 21 documentation, certificate lifecycle reports for ICT risk testing, module attestations, and the supplier readiness evidence chain. The practical takeaway is to structure discovery and inventory output so it doubles as audit evidence from day one, rather than rebuilding it under deadline.

              Attendees will leave with the failure modes that recur regardless of sector, a clear signal for when to abandon in-place hybrid roots, and a sequence that links assessment, migration, and assurance so the three are not rebuilt separately. The content is experience-led and vendor-neutral, framed entirely around what was observed in the field.
            speakers:
              - Parnashree Saha
            locations:
              - plenary

          - title: "Project Hail Merkle: Rethinking Qualified Trust Services with Merkle Tree Certificates"
            description: |
              Digital trust is entering a new phase. For decades, certificates have been the invisible backbone of secure digital interactions: reliable, proven, and essential. But the environment around them is changing fast. Trust ecosystems are becoming larger, more connected, more automated, and more demanding. The question is no longer only how we protect trust. It is how we scale it, prove it, and govern it in a world of growing complexity.

              This talk explores the emerging concept of Merkle Tree Certificates and asks a fundamental question: could this be the next major step in the evolution of digital trust, especially for qualified trust services? Merkle-tree-based approaches promise a new way of thinking about certificates. By embedding certificate-related information into cryptographically protected structures, they can enable more efficient proofs, greater transparency, and new models for validation at scale. What sounds like a technical refinement may in fact signal something much bigger: a shift from isolated certificate objects to more dynamic, auditable, and internet-scale trust architectures.

              For the world of qualified trust services, this is especially significant. Here, trust is never just a technical matter. It is also legal certainty, regulatory compliance, operational reliability, and public confidence. That is why the real opportunity, and the real challenge, lies not only in the cryptography itself, but in the question of how such new models could fit into highly regulated trust environments. Can innovation deliver more transparency and scalability without weakening assurance, accountability, or supervision?

              The talk connects these developments to the future of qualified electronic signatures, seals, website authentication, and emerging wallet-based ecosystems. It highlights both the promise and the unresolved questions: interoperability, standardization, liability, governance, and the broader impact on trust frameworks that were built for a different era.

              Ultimately, this session is not just about a new certificate concept. It is about the future architecture of trust. As digital infrastructures evolve, trust services must evolve with them. Merkle Tree Certificates may be one of the technologies that help define that next chapter, where trust becomes not only secure, but also scalable, transparent, and ready for the demands of the next digital decade.
            speakers:
              - Kim Nguyen
            locations:
              - blue_hall

          - title: "From Fear to Hybrid: Making PQC Less Scary"
            description: |
              European agencies such as ANSSI and BSI recommend the hybrid use of post-quantum cryptographic algorithms alongside traditional schemes, driven by concerns regarding the maturity and long-term security assurance of purely post-quantum solutions. This talk focuses on two prominent approaches to fulfilling this requirement through compound algorithms: the IETF's composite signatures and KEMs, as well as Intelligent Composed Algorithms.

              The original motivations behind each approach and their respective design decisions will be presented in detail, including the cryptographic construction and the security properties they aim to achieve. The advantages and drawbacks of both approaches will be examined, highlighting how they can contribute to crypto agility and how they differ from other hybridization concepts such as hybrid certificates or multiple signatures. The talk also addresses current interoperability considerations and implementation challenges. Finally, the state of standardization within the IETF and other relevant bodies will be reviewed, alongside existing support and an outlook on future work in the field of hybrid algorithms.
            speakers:
              - Jan Klaußner
            locations:
              - room_a

          - title: "From ECDSA to Post-Quantum Signatures: Practical Lessons from Migrating Wallet-Based Transaction PKI"
            description: |
              Many post-quantum migration discussions focus on TLS, certificates, and enterprise PKI. A different but increasingly important case is wallet-based transaction infrastructure, where long-lived accounts, public-key exposure, signature verification, hardware constraints, recovery flows, and user experience all interact with cryptographic migration.

              This session presents practical lessons from designing and implementing a migration path from ECDSA-based transaction signing toward post-quantum signatures in an EVM-like blockchain environment. It focuses on architecture and engineering trade-offs rather than product claims: key generation and storage, address derivation, signature-size impact, transaction encoding, verification cost, backward compatibility, testnet strategy, smart-account and vault-based migration models, and how to avoid creating unsafe hybrid systems that merely add complexity without reducing risk.

              The talk also examines the relationship between blockchain wallet infrastructure and traditional PKI concepts: identity binding, certificate-like assertions, key lifecycle management, recovery, revocation, policy enforcement, auditability, and hardware-backed key protection. Special attention is given to migration patterns that allow existing assets or accounts to gain post-quantum authorization controls without assuming an overnight replacement of legacy systems.

              Attendees will leave with a concrete checklist for evaluating post-quantum readiness in transaction-signing systems: where classical signatures remain a dependency, which components need cryptographic agility, what must be measured before migration, and which design decisions can create operational or security risks during the transition.
            speakers:
              - Ricardo Agustin Toledo Mañani
            locations:
              - room_b

          - title: "Workshop: Post-Quantum Trails Board Game"
            description: |
              This interactive, hands-on workshop is centred around Post-Quantum Trails, an educational board game designed to demystify the complexities of migrating to post-quantum cryptography (PQC), a joint project brought to life by Cybernetica and the OpenSSL Foundation.

              As quantum computing advances, the transition to quantum-safe cryptographic standards is no longer optional; it has become urgent. Yet for many developers and stakeholders, the migration process feels overwhelming and too abstract. The game brings this journey to life, guiding players through the real-world challenges of developing, standardizing, and deploying PQC solutions, and highlighting both the technical problems and the strategic trade-offs involved.

              Participants will learn about the PQC landscape, understand the risks of delayed migration, and engage in a collaborative simulation that reflects actual industry challenges. Earlier versions of this workshop have been run at the OpenSSL Conference and NordSec 2025, and the facilitators will introduce the game, explain the rules, and be on hand throughout to help players, answer questions, and discuss the awareness aspect of PQC migration.
            track: Workshop
            durationMinutes: 60
            speakers:
              - Jelizaveta Vakarjuk
              - Nikita Snetkov
            locations:
              - room_c

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_d

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_e
      - time: "14:30"
        sessions:
          - title: Implementing the PKI Consortium PQC Maturity Model at Siemens Trust Centre
            description: |
              As the transition to Post-Quantum Cryptography (PQC) accelerates, organizations face a challenge that extends far beyond algorithm replacement. Success depends on understanding cryptographic dependencies, coordinating multiple stakeholders, managing supplier readiness, and establishing a sustainable model for cryptographic agility. The PKI Consortium's Post-Quantum Cryptography Maturity Model (PQCMM) provides a structured framework for assessing the quantum readiness of products and services within the supply chain. At Siemens Trust Centre, we examine how this vendor-centric model can be expanded into an enterprise-wide governance and transformation framework.

              This session presents Siemens' approach to adapting the PQCMM for one of the world's largest industrial and technology environments, spanning enterprise IT, public key infrastructure, product security, and operational technology. We describe how PQCMM was integrated into a broader cryptographic governance strategy, enabling consistent assessment of suppliers, internal platforms, PKI services, smart card technologies and virtual smart card solutions.

              The presentation shares practical lessons learned while building a cryptographic inventory, establishing quantum-readiness assessment criteria, evaluating strategic vendors, and defining measurable maturity targets across diverse technology domains. Particular emphasis is placed on translating technical PQC requirements into actionable governance mechanisms, supplier management processes, and migration roadmaps. We will present findings and obstacles from the implementation from HSMs, CAs and RAs, as well as governance mechanisms we had to redesign. Attendees will learn why cryptographic visibility and dependency management often represent greater challenges than algorithm adoption itself, and why cryptographic agility must become a core enterprise capability rather than a one-time project outcome.

              The session concludes with practical experiences to operationalize PQC readiness, establish common maturity metrics across technology ecosystems, and align supplier management, PKI modernization, and enterprise transformation activities under a single strategic framework.
            speakers:
              - Wilko Wenzel
            locations:
              - plenary

          - title: "PQC Transition in Production, Season 1: Network Encryption"
            description: |
              As a provider of cybersecurity solutions, Stormshield has been working on the post-quantum transition for years, for its products but also for its own IT transition. 2026 is the year when the transition starts to reach production. Focus is put on encryption, because of the store-now-decrypt-later risk, and on the network, for various reasons presented during the talk.

              In this session we look at both technical aspects (which protocols, which tools, hints and feedback) and strategic aspects: what to do first, what to delay, and the non-technical issues. The session closes with a first feedback on what was easy, what was not, and what has not been migrated as expected during this year.
            speakers:
              - Yvan Vanhullebus
            locations:
              - blue_hall

          - title: "PQC Budgeting: How to Address the Costs of PQC Readiness"
            description: |
              As governments and regulatory bodies around the world accelerate guidance and migration timelines for Post-Quantum Cryptography (PQC), mid-to-large enterprises face an increasingly urgent question: how much should we budget, and where do we begin? While the timeline for a cryptographically relevant quantum computer remains uncertain, the need to prepare is becoming a board-level risk management priority.

              This session presents a pragmatic approach to building a multi-year PQC budget that balances technical requirements, operational realities, and financial constraints. Attendees will explore the primary cost drivers of a successful migration, including cryptographic discovery and the creation of a Cryptographic Bill of Materials (CBOM), certificate lifecycle modernization, crypto-agility initiatives, HSM and key management upgrades, application remediation, testing, governance, and workforce enablement.

              The presentation also discusses how organizations can prioritize investments based on business risk, regulatory obligations, and cryptographic exposure, enabling a phased migration rather than a costly rip-and-replace approach. Participants will leave with a practical budgeting framework, recommended milestones, and executive-level strategies for securing funding and building organizational consensus. The objective is to help enterprises transform PQC readiness from an abstract future concern into a measurable, achievable cybersecurity program with clear business value.
            speakers:
              - Blair Canavan
              - Jaime Gómez García
            locations:
              - room_a

          - title: "Governing the PQC Transition in the US and the EU: A Comparative Analysis"
            description: |
              Although the US has been regarded as a frontrunner in the global pursuit of quantum-readiness, distinguished by its top-down approach to the PQC transition, hosting the main institutional venue undertaking PQC standardisation, and producing a considerable amount of technical guidance through its specialist agencies, it has been facing significant domestic implementation challenges. Both executive and legislative bodies have cast a critical light, citing the slow pace of progress, the limited scope of the current US PQC migration strategy (making it mandatory only for federal government) and the lack of appropriate leadership.

              The adjustments that have been proposed include, among others, more streamlined governance, performance measurement, and better encouragement for all sectors to embrace this change. New legislative proposals addressing the PQC transition have since proliferated and executive actions have reportedly been in the pipeline. After backsliding from some elements of the previous administration's PQC transition course in June 2025, the current administration released its Cyber Strategy in March 2026, promising to accelerate PQC deployment. Meanwhile CISA, one of the key actors in facilitating this transition, has been exposed to a rather precarious situation, leading to a sizeable reduction of its workforce, which may have some disruptive impact on the governance of this process.

              In the EU the PQC migration has been unfolding quite differently. Here, the process has been driven for some time by strong policy entrepreneurship and expertise coming from national cybersecurity authorities in several Member States, which can be viewed as a bottom-up dynamic. The EU-level strategy formulated in 2024 appears to be more comprehensive than the US equivalent, as alongside public administrations it encompasses critical infrastructures. There is also a sound legal base in EU law, consisting of a set of regulatory instruments requiring state-of-the-art cybersecurity measures commensurate with the risks and fulfilment of the principles of privacy-by-design and security-by-design.

              Arguably, however, this should be strengthened by making requirements regarding PQC more explicit and by streamlining them across the various existing instruments and guidelines for consistency and legal certainty. There is also a need for the EU to enhance its funding for PQC development and deployment, based on the rationale that it represents the main solution in countering the quantum threat, especially in the near term. Recent EU legislative proposals have generally stressed the increasing urgency of enacting the PQC migration, and although the EU has tangibly contributed to the US-led PQC standardisation endeavours with its scientific excellence in the field of cryptography, these new proposals also signal that the EU might now be set to pursue its own framework.

              Attendees of this session will benefit from a granular view of how the PQC transition has been governed in these two jurisdictions and what future projections can be identified.
            speakers:
              - Laima Jančiūtė
            locations:
              - room_b

          - title: Retaining Cryptographic Control When Agentic AI Accelerates PQC Migration
            description: |
              As organisations use AI to accelerate PQC migration, they risk creating a new form of crypto sprawl: AI-generated code that embeds algorithms, key references, provider choices, and local policy assumptions. This session shows how policy-bound cryptographic interfaces, CI/CD guardrails, and intent-level APIs can help teams use AI without losing cryptographic control.

              As organisations prepare for PQC migration, agentic AI introduces a new governance risk: coding agents can generate cryptographic integrations faster than security teams can review, approve, and manage them. Without clear constraints, AI-generated applications may hard-code algorithms, key references, provider calls, fallback logic, and local policy assumptions across the software estate. The result can be greater crypto sprawl, reduced crypto agility, and new obstacles to controlled PQC migration.

              This session presents an architecture and API approach for using AI safely in PQC migration programmes. Instead of allowing AI-generated applications to make cryptographic decisions, applications should express cryptographic intent while policy, key association, provider routing, algorithm selection, audit, and lifecycle management remain centrally governed. The session covers CI/CD guardrails, coding standards, policy-controlled migration from classical to post-quantum algorithms, and evidence collection for CBOM and phased cutover planning. Attendees will leave with a practical model for preventing AI-generated crypto sprawl while still using AI to accelerate PQC readiness.
            speakers:
              - Tobias Bojesen
              - Guillaume Forget
            locations:
              - room_d

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_e
      - time: "15:00"
        title: Break

      - time: "15:30"
        sessions:
          - title: Insights into a Post-Quantum Safety Transformation Journey
            description: |
              The quantum threat is no longer theoretical. Yet moving a large organization from awareness to structured action, systematically and without paralysis, remains genuinely difficult. This talk shares practical insights from two years inside a live post-quantum security transformation, built around four pillars.

              Planning despite uncertainty: how hypothesis-based planning keeps long-term strategy adaptable, and how transparency and accountability turn ambiguity into a manageable condition rather than a blocker. Making risk tangible: abstract threats don't move budgets, so we present our framework for prioritizing across a complex IT landscape, including a method for quantifying quantum exposure and translating it into a concrete sense of urgency for decision-makers.

              Building awareness that sticks: transformation stalls without broad understanding, so we share what has worked for propagating post-quantum safety awareness internally across all organizational levels, and externally through collaboration with partners and suppliers. Governing what you measure: a real insight into our operative governance model, the KPIs we track, the maturity framework we developed, early results, and an honest outlook on the road ahead.

              We offer no definitive answers; quantum readiness is still a work in progress for us, as it is for most. What we can offer is a transparent view into a complex, ongoing transformation and the frameworks that have helped us navigate it.
            speakers:
              - Cristof Kaufmann
              - Thomas Maes
            locations:
              - plenary

          - title: "Adventures with LMS: Lessons from Implementing Stateful Hash-Based Signatures for Post-Quantum Trust"
            description: |
              LMS is a proven post-quantum signature scheme, but its stateful nature creates deployment challenges that are easy to underestimate. This session shares practical lessons from implementing LMS in real-world post-quantum trust scenarios, with a focus on one-time signature key management, constrained environments, firmware-style workflows, verification performance, and operational failure modes. Attendees will learn where LMS fits, where it does not, and what engineering decisions are needed to deploy stateful hash-based signatures safely as part of a quantum-resistant architecture.
            speakers:
              - Dave Butcher
            locations:
              - blue_hall

      - time: "16:15"
        sessions:
          - title: "The Board Factor: What Makes PQC Programs Succeed or Stall"
            description: |
              Most PQC programs are structurally set up to fail. Not for lack of standards or technology, but because the complexity of organizational systems is beyond what their programs are designed to control.

              Post-quantum cryptography migration is more than a technology upgrade. It is a multi-year enterprise transformation that cuts across business lines, processes, vendors, data, contracts, procurement, risk appetite, funding, operating models, and executive accountability. These are not technology variables. Yet many organizations are still treating it as a technical remediation exercise. That is a mistake.

              Digital trust is a critical business asset. And the cryptographic infrastructure that supports it is a highly distributed, deeply embedded, complex digital estate with dependencies that span every system, every process, and every layer of the technology stack. In this way, parallels can be made to data governance: fifteen years of CDO mandate cycles rife with failure, trying to govern something that is everywhere, essential, and owned by no one. PQC has a hard 3 to 7-year deadline. We simply cannot afford to make the same mistakes. This is not only a cryptography problem. It is a complex systems problem.

              PQC programs face nearly every structural condition that predicts failure: a long-time horizon, ambiguous impact timing, no single natural owner, deep technical complexity, unclear business prioritization, complex and unmapped dependencies, limited cryptographic literacy, budget uncertainty, and a strategic portfolio process that favours near-term value creation over invisible long-term risk reduction. Add to this a fundamental accountability problem: the executive leaders responsible for taking action today may not be the same as those who face the consequences tomorrow. The usual forcing functions for urgency, ownership, and escalation are weak. In the absence of authoritative action, the cryptographic estate is heading for the same governance failure mode we saw with enterprise data: granular, everywhere, essential, owned by no one, and left in the hands of IT.

              Ashby's Law for complex systems is clear: a system will defeat any controller that underestimates its complexity. Operational budgets, decision rights, and risk acceptance are distributed throughout the system; only the board holds authority over all three.

              The session opens with two questions put directly to attendees: (1) why will your PQC program succeed when so many enterprise-scale programs fail, and (2) who is accountable for its success (or failure)? Participants respond in writing. Many will struggle, exposing the real issue: not whether PQC matters, but whether organizations understand the conditions required to succeed, and who should be held accountable if they don't.

              Drawing on systems theory principles and over 30 years designing, delivering, and remediating large-scale transformations and operating models, this session examines why PQC migration is structurally harder than most organizations currently understand. It shows why cryptographic inventory, technical standards, vendor readiness, and migration planning are necessary but insufficient, and why board engagement is the single most determining factor in a program's success. The session closes by returning to the same two questions, this time providing concrete, practice-tested moves to establish who is ultimately accountable for PQC program success and to secure the board engagement needed to make sure yours does.

              The issues that will stall many PQC programs are visible and navigable. Can you engage your board effectively to overcome them?
            speakers:
              - Louise Davey
            locations:
              - plenary

          - title: Gaming the Speed-vs-Memory Tradeoff for ML-DSA and ML-KEM
            description: |
              FIPS is only a suggestion, sortof. Specifically, FIPS only requires "mathematical equivalence" to the listed algorithms, and that gives a surprisingly wide latitude for implementations to play algorithmic games in search of either fast or small implementations.

              This talk will explore speed-vs-memory tradeoff techniques applicable to the ML-DSA and ML-KEM algorithms and the results that they obtain within the Bouncy Castle Rust library. We start with a close look at the "default" implementation, then at what you can do to move around the High Speed <--> Low Memory spectrum. In one direction, you can pre-expand intermediate values at key-load time for faster sign, verify, encaps and decaps operations which gives performance increases in the 40% - 60% range (especially valuable if doing multiple operations against the same key). In the other direction, your in-memory private key representation can consist of only intermediate seed values and you can re-derive the active lattice values one entry at a time as they are needed; you pay a penalty for deriving the same intermediate values multiple times for a dramatic reduction in memory footprint. This technique has a particularly pronounced effect on ML-DSA where ML-DSA-87.sign() can be performed in under 30 kb of peak memory usage, which represents roughly a 7.5x decrease in memory usage in exchange for a 6x increase in runtime; which is a win on heavily-loaded servers where parallelism is gated by RAM not by CPU.
            speakers:
              - Mike Ounsworth
            locations:
              - blue_hall

      - time: "17:00"
        noTransition: true
        sessions:
          - title: Closing (Day 1)
            description: |
              Brief closing remarks for the red hall audience and a preview of Day 2.
            speakers:
              - Paul van Brouwershaven
            locations:
              - plenary

          - title: Closing (Day 1)
            description: |
              Brief closing remarks for the blue hall audience and a preview of Day 2.
            speakers:
              - Albert de Ruiter
            locations:
              - blue_hall

      - time: "17:05"
        title: End of day one

    2026-12-02:
      - time: "08:00"
        title: Registration

      - time: "09:00"
        noTransition: true
        sessions:
          - title: "Welcome back — Day 2"
            description: |
              Welcome and agenda highlights for the red hall audience: a quick look at what is on today and how to get the most out of it.
            durationMinutes: 5
            speakers:
              - Albert de Ruiter
            locations:
              - plenary

          - title: "Welcome back — Day 2"
            description: |
              Parallel welcome and agenda highlights for the blue hall audience.
            durationMinutes: 5
            speakers:
              - Sven Rajala
            locations:
              - blue_hall

      - time: "09:05"
        sessions:
          - title: Estonian PQC Migration Roadmap
            description: |
              This presentation outlines Estonia's roadmap for transitioning the public sector to post-quantum cryptography (PQC), officially released in April 2026. Given the significant heterogeneity in cryptographic architectures, technical capacity, and operational criticality across public sector organisations, a uniform migration approach is neither feasible nor optimal. Instead, the roadmap introduces a risk-based categorisation framework that divides public sector institutions into four priority categories (Very High, High, Medium, and Low), each associated with distinct migration timelines and tailored implementation guidelines. A particular focus is placed on low-priority organisations, whose transition steps remain underdeveloped in most existing roadmaps.

              The talk first presents the developed organisation categorisation approach and the underlying risk-assessment criteria. It then details the migration framework, outlining preparation, cryptographic inventory, implementation, and monitoring steps tailored in their specifics to each priority level. Finally, in a landscape where multiple national and international PQC migration strategies are converging, the session presents a comparison with some of the existing roadmaps, along with lessons learned through the process of constructing Estonia's PQC migration roadmap.
            speakers:
              - Jelizaveta Vakarjuk
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "09:35"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: An Evaluation of PQC Algorithms in DNSSEC Using Real-World Data
            description: |
              Over the last years, we have conducted a series of experiments to establish which PQC algorithms would be best suitable for replacing RSA and ECDSA in DNSSEC, the security extension of DNS. As a core internet protocol, it is important that DNS remains working securely when powerful quantum computers exist. DNS contains data that fits in a single small UDP packet, which is fast and reliable, or switches to a slower TCP connection for bigger packets, which uses more resources on the server side. Small signatures and public keys are therefore preferred.

              We present insights from our experiments after implementing PQC in the toolchain of DNSSEC, and testing PQC algorithms using real-world data from a top-level-domain operator and a large DNS resolver operator. Using real-world data allows us to measure the real impact of PQC algorithms on both client and server performance.
            speakers:
              - Elmer Lastdrager
            locations:
              - blue_hall

      - time: "10:15"
        title: Break

      - time: "10:45"
        noTransition: true
        sessions:
          - title: "Your Suppliers Aren't Ready: PQC Supply Chain Readiness"
            description: |
              You have mapped your internal cryptographic assets, you have a migration plan, and you know which algorithms you are moving to. Then you open a ticket with your HSM vendor, your cloud key management provider, your identity platform, your network appliance manufacturer, and the answers range from vague to contradictory to silent. Your suppliers are the gap between your migration plan and your migration reality.

              The challenge is not limited to hardware security modules. Every product and service that uses cryptography (software libraries, CAs, signing services, authentication platforms, enterprise SaaS, embedded firmware) is a dependency in your PQC migration. And most of them are somewhere between Level 0 (nothing implemented) and Level 2 (production-ready but no inventory, no agility, no roadmap transparency). This session opens with a ten-minute introduction to how the PKI Consortium's PQC Maturity Model (PQCMM) works in practice, then the panel takes over: what does it actually look like to mandate PQC supplier requirements at a large institution, what do assessors find when they start evaluating products against a structured framework, and what would accelerate adoption of a common standard across the supplier ecosystem.

              Attendees leave with a practical starting point: how to introduce the PQCMM into procurement for high-priority suppliers today, what to put in contracts, and how to handle the inevitable exceptions.
            track: Panel discussion
            durationMinutes: 60
            speakers:
              - Paul van Brouwershaven
              - Fred Roos
              - Lory Thorpe
              - Rieck Manfred
            locations:
              - plenary

          - title: Stop Hiring PQC Experts !!!
            description: |
              It is time organisations stopped making the mistake of assuming they need to hire a PQC expert. The real challenge has nothing to do with solving cryptography or researching new algorithms. PQC is not a cryptographic research problem anymore. It is a PKI, enterprise and operations problem.

              Let's be blunt: hiring PQC experts without fixing PKI operations is like hiring quantum physicists to fix a broken plumbing system. The mathematics is not the problem, the infrastructure is. Most organisations still struggle with the basics: expired certificates, unknown trust relationships, weak crypto visibility, manual certificate processes and poor lifecycle governance.

              This session challenges the growing narrative that organisations need dedicated PQC specialists before they can begin preparing for the quantum era. Instead, it argues that PQC migration is fundamentally a PKI operational challenge. Replacing cryptographic algorithms is only one part of the problem; the real challenge is operationalising cryptography at enterprise scale across complex environments, legacy systems, hybrid infrastructures, certificate lifecycles, trust chains and governance models.

              This is where the real insight emerges. The people who can actually solve this are not those who understand the deepest mathematics of PQC, but those who understand how trust is built, managed, and sustained across an enterprise. PKI experts (the teams already responsible for certificates, key lifecycles, and trust infrastructure) are the ones who must be empowered.

              PQC is not about inventing cryptography anymore. It is about surviving its transformation. The organisations that succeed in the PQC transition will not be the ones with the most theoretical quantum knowledge. They will be the ones with mature PKI foundations, automated certificate management, strong governance and operational discipline. Provocative by design, this talk reframes PQC migration from a research problem into a real-world enterprise execution challenge, and explains why fixing PKI maturity today is the most important step toward becoming quantum ready tomorrow.
            track: Lightning talk
            speakers:
              - Kiruthiga Chandrasekaran
            locations:
              - blue_hall

          - title: To be announced
            description: |
              Session details will be announced soon.
            durationMinutes: 105
            locations:
              - room_a
      - time: "11:00"
        noTransition: true
        sessions:
          - title: Tackling PQC and 47-Day Certificates in Parallel
            description: |
              In the next few years every enterprise will have to deal with two seismic shifts in digital trust that will redefine all security strategies: the phased reduction of SSL/TLS certificate lifespans to just 47 days by 2029, and the need to adopt quantum-resistant cryptography by 2030. Either mandate on its own is a major challenge. Together they represent an unprecedented technology lift for IT and security teams.

              The good news is that the foundational work for each of these initiatives helps the other. Achieving crypto agility starts with certificate agility. Organizations must gain complete visibility and control over their certificate landscape to ensure widespread use of PQC algorithms for data in transit. The coming step-down of maximum TLS server certificate lifespans to monthly renewals over the next three years will necessitate exactly the same thing. Wise enterprises will combine these two initiatives to eliminate redundant technology development and expense, avoid collisions between projects, and ensure overall quality.

              This presentation shares original research on enterprise readiness for these trends and describes the opportunity for enterprises to improve the outcomes of both initiatives by working on them together. Attendees will learn how a unified, automated approach to certificate automation and management can eliminate redundant efforts, reduce risk, and build agility for both mandates.
            track: Lightning talk
            speakers:
              - Tim Callan
            locations:
              - blue_hall

      - time: "11:15"
        noTransition: true
        sessions:
          - title: How to Actually Start Your PQC Transition
            description: |
              In discussions around the PQC transition, the technical migration challenge often receives the most attention. In practice, however, organizations face significant barriers before any cryptographic transition can begin: establishing governance, securing funding, aligning stakeholders, and setting up effective program management structures.

              This talk builds on a whitepaper currently being developed through hands-on experience from members of two Belgian communities, Quantum Circle and the Belgian Cybersecurity Coalition. It provides practical guidance for the early stages of PQC adoption, focusing on why these initial steps are complex, how organizations can structure the necessary PQC migration engine, and how to justify the scale and urgency of such a transformation. In addition, the talk challenges commonly repeated advice on initial migration preparation and prioritization, offering a more pragmatic alternative approach.
            track: Lightning talk
            speakers:
              - Joachim Vererfven
            locations:
              - blue_hall

      - time: "11:30"
        noTransition: true
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "11:45"
        sessions:
          - title: Role of CBOM in a Telco's PQC Journey
            description: |
              This presentation on behalf of the GSMA PQTN task force will examine the role of a "Cryptographic Bill of Materials" in the telecommunication sector. The session will explore CBOM and its relationship to the Software Bill of Materials (SBOM), review the current standards landscape, identify telecommunications-specific use cases, and outline the regulatory drivers shaping adoption.

              The need for industry alignment on CBOM use, format, and content as a means to simplify the management and communication of cryptography between parties will be highlighted. This "CBOM profile" will provide telco operators with a structured way to express cryptographic requirements, plan the migration to post-quantum cryptography, and manage cryptographic assets across their lifecycle, while giving vendors the mechanisms to communicate the cryptographic assets and future roadmap commitments associated with their products and services to operators and other stakeholders. The session concludes with actionable recommendations for telco network operators, vendors, and other relevant stakeholders engaged in the transition to post-quantum cryptography.

              The presentation will be of interest to network operators, the entire telecommunications supply chain, and government regulators. It complements other standardization and industry adoption efforts.
            speakers:
              - Luke Ibbetson
              - Lory Thorpe
            locations:
              - plenary

          - title: Lessons Learned from Deploying LMS at Scale
            description: |
              Stateful hash-based signatures such as LMS are standardised and well understood, but translating them into deployable products involves challenges that are often absent from standards and academic literature.

              This talk discusses the practical realities of deploying a stateful hash-based scheme in long-lived hardware-rooted systems. Drawing on experience securing firmware update mechanisms in commercial PCs and printers, it explores how standards guidance, hardware lifecycles, resilience requirements, certification considerations and business constraints influenced key design decisions.

              It covers lessons from adopting the LMS standard into security features deployed at scale, including the challenges of balancing security, resilience, certification and operational requirements, and reflects on how later developments in standards, certification programmes and industry guidance reinforced, challenged or reshaped those decisions, and what this means for future quantum-resistant migrations.
            speakers:
              - Thalia Laing
            locations:
              - blue_hall

      - time: "12:30"
        title: Lunch

      - time: "14:00"
        sessions:
          - title: "PQC Starts at the Root of Trust: The Role of TPMs in Protecting Next-Generation Device Identities"
            description: |
              As organizations prepare for the transition to post-quantum cryptography, much of the conversation focuses on algorithms, certificates, and PKI infrastructure. Yet the success of any migration ultimately depends on where cryptographic keys are generated, stored, and protected. For billions of enterprise and IoT devices, that foundation is the Trusted Platform Module (TPM).

              This session explores the role of TPMs as the hardware root of trust enabling post-quantum migration for device identities and machine credentials. From certificate enrollment and key attestation to secure storage and cryptographic agility, TPMs provide the security foundation that allows PKI ecosystems to evolve without compromising trust.

              We will examine the practical challenges PKI teams face when introducing post-quantum algorithms into existing deployments (including the hardware refresh cycle) and describe how TPM capabilities can support the transition while maintaining compatibility with existing enterprise and IoT infrastructures.

              Attendees will gain a clearer understanding of how hardware-backed key protection intersects with PQC deployment, why device identity should be part of every migration roadmap, and what steps organizations can take today to prepare for a quantum-resilient future.
            speakers:
              - Antonio Javier Cabrera Gutierrez
            locations:
              - plenary

          - title: The PQC Ready German ID Card
            description: |
              Post-quantum cryptography (PQC) adoption is mandated for critical EU infrastructure by 2030, yet integration into existing identity document ecosystems presents significant cryptographic and performance constraints. National ID cards with 10-year validity require quantum-resistant protection from issuance, necessitating a pragmatic transition strategy that balances algorithmic security guarantees with hardware resource limitations.

              This talk points out high-risk spots in the ID card ecosystem and the key requirements for its operation. Subsequently an approach for a step-by-step PQC migration is presented, including possible scenarios for the underlying Public Key Infrastructure. The solutions employ different NIST-standardized PQC algorithms alongside traditional cryptography using hybrid schemes.

              The feasibility of this approach is demonstrated by the realization of a functional demonstrator implementing hybrid cryptographic schemes on a resource-constrained, ISO 7816-compliant smart card, addressing the critical challenges of signature generation and verification time and memory footprint during authentication operations. Finally, the results of the demonstrator are presented along with the identified challenges ahead.
            speakers:
              - Jan Klaußner
            locations:
              - blue_hall

          - title: Quantum-Safe Audit Log Relying on Attestation Procedures
            description: |
              Last year, we examined how hardware security modules can provide cryptographic attestation, i.e., a signed snapshot of the state of an HSM and/or of its keys. Trust in cryptographic infrastructure, however, often requires more than a snapshot; it requires proof of history. This presentation introduces cryptographically verifiable audit logs for hardware security modules, a mechanism that produces a tamper-evident, independently verifiable record of every operation performed on a cryptographic object over its lifetime. Where attestation tells you what a key looks like today, an audit log tells you everything that was done to it and when. Key ceremonies require a verifiable sequence of authorized operations that no snapshot can reconstruct; key migration requires a temporary export, so the destination device's attestation cannot prove the process was correct, but the combined audit logs of both devices can. The cryptographic architecture behind this relies on event chaining and attested log state, with tooling that runs entirely outside the HSM so that an auditor can verify the record without device access. For long-term validity, all of this must rest on quantum-safe roots of trust provisioned at manufacturing time.
            speakers:
              - Olivier Couillard
            locations:
              - room_a

          - title: Scaling of Memory and Bandwidth Requirements of Post-Quantum Signatures with Message Size
            description: |
              In this work we analyse the qualitative memory and bandwidth efficiency properties of the currently standardised post-quantum signatures as such, and of their protocol integrations mainly in the X.509 context. The term qualitative in this respect refers to how memory and bandwidth requirements scale with the size of the signed message.

              Specifically, we address the question of how far the algorithms support online computations, also known as streaming, with respect to the signed message in the signing and verification operations. Further, we review the possibilities for the pre-computation of a short message representative outside the cryptographic module responsible for the signing or verification operation of the different signature schemes. We also give a preview of the corresponding cryptographic API of the PKCS#11 standard, which introduces numerous PQC signature algorithms in the upcoming version 3.2.

              We demonstrate that for specific realistic use cases, the qualitative memory and bandwidth efficiency of the PQC signature schemes in protocol use varies widely and tends to be substantially degraded compared to the traditional signature schemes based on RSA and elliptic curves, which always allow for the pre-computation of a short message representative in the form of a hash value. Our results are relevant to PQC migrations of existing applications using traditional RSA or elliptic curve schemes.
            speakers:
              - Falko Strenzke
            locations:
              - room_b

          - title: "Measuring PQC Readiness for PKI: Introducing the PKI Maturity Model Extension Framework and Its First Extension"
            description: |
              Most organisations approaching post-quantum migration share the same blind spot: they have a roadmap, but no honest way to measure where their PKI actually stands. This session introduces two published outputs of the PKI Consortium's PKIMM Working Group: the PKI Maturity Model Extension Framework, and the PQC Readiness Extension for PKI built on top of it.

              The PKI Maturity Model already helps organisations benchmark their PKI programmes against an industry reference structured around four modules and fifteen capability categories. The Extension Framework defines a standardised way to overlay targeted, fast-moving maturity criteria (PQC, automation, cryptographic agility) onto the existing categories, with consistent scoring, weighting, and reporting rules. The PQC Readiness Extension, authored by Kennedy Nwup, is the first published extension, giving PKI owners a defensible answer to questions their CISOs, regulators and auditors are starting to ask.

              In this joint session, Roman Cinkais (Chair, PKIMM WG) and Kennedy Nwup (Vice Chair, PKIMM WG, and author of the extension) walk through the design of the Extension Framework, present the PQC Readiness Extension in detail, show how it is intended to be used in practice, and reflect on turning a working group draft into a published, community-endorsed specification.

              Attendees will leave with a published framework and a PQC Readiness Extension they can apply to their PKI programme straight away.
            speakers:
              - Roman Cinkais
              - Kennedy Nwup
            locations:
              - room_c

          - title: "HAPKIDO Handbook: Navigating the Transition to Quantum-Safe PKI"
            description: |
              PKIs operate on the assumption that trusted credentials remain unforgeable over their lifetime. Advances in quantum computing challenge this premise: credentials trusted today may become forgeable in the future, introducing a "trust now, forge later" risk that directly impacts the integrity of digital identities and trust anchors.

              For PKI-dependent ecosystems, migration is not just a cryptographic upgrade problem. Long-lived certificates, complex trust hierarchies, and cross-sector dependencies mean that failures can propagate systemically, affecting entire digital trust ecosystems. Yet progress toward quantum-safe PKI remains fragmented, slowed by uncertainty around standards, timelines, and ownership. The HAPKIDO societal impact assessment shows that compromised PKIs could trigger cascading failures across sectors, from disruption of public services to economic instability in banking systems.

              This talk presents the HAPKIDO Handbook, which provides a consolidated, research-based framework to guide organisations and policymakers through the transition to quantum-safe PKI. It combines technical insights, governance perspectives, and societal risk analysis into a unified approach, with two main goals: raising awareness and providing actionable insights to support decision-making.

              The handbook presents two key contributions: a societal risk assessment method that translates abstract quantum threats into concrete organisational and societal risks, enabling prioritisation of critical assets and services; and a five-stage growth model guiding organisations from awareness to full ecosystem adaptation, emphasising the need for coordinated action across organisational and sectoral levels. Together, these frameworks position the transition not as a technical upgrade, but as a multi-actor transformation requiring alignment across ecosystems.

              The handbook highlights that early action is possible and necessary, including cryptographic inventory and adoption of cryptographic agility practices, as well as jointly testing hybrid solutions. Success depends on coordinated efforts across organisations and policymakers acting within a specific sector to avoid fragmentation and ensure interoperability. Stakeholders should begin risk-based assessment, invest in early experimentation, and actively participate in sector-specific collaboration and standardisation efforts.
            speakers:
              - Dayana Spagnuelo
              - Manon de Vries
            locations:
              - room_d

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_e
      - time: "14:30"
        sessions:
          - title: "Trust Now, Forge Later: A Live Exposure Demonstration"
            description: |
              Current post-quantum planning is dominated by one clock, harvest-now-decrypt-later (HNDL), but for signature infrastructure the binding exposure is trust-now-forge-later (TNFL). Once a cryptographically relevant quantum computer arrives, long-validity signing anchors become forgeable, leading to loss of trust. Using the global passport and national identity infrastructure as an empirical model for TNFL exposure analysis and remediation prioritisation, this session shows in a live demonstration exactly how trust could collapse if urgent, globally coordinated action is not put in place.

              The dataset is the ICAO Master List: the self-signed country signing certificate authority (CSCA) roots that anchor verification of ICAO 9303 compliant machine-readable travel documents (MRTDs) worldwide, published as a Cryptographic Message Syntax (CMS) structure and cross-checkable against the German Federal Office for Information Security (BSI) list. Both are public and neither requires Public Key Directory (PKD) participation at the CSCA layer.

              The demonstration walks through the pipeline end to end, using open tooling only so that anyone can reproduce it: hash and record provenance of the source file; unwrap the CMS encapsulated content and split the CscaMasterList into per-certificate DER with a standard-library walker; extract algorithm, key size and validity fields; then derive three outputs: installed base by algorithm and key-strength band, the share of anchors whose notAfter extends past a set of CRQC scenario years, and a fingerprint-level reconciliation between the two source lists. Every figure regenerates from the script; none is asserted by hand. Findings are reported in aggregate, without singling out individual issuers.

              The reusable corollary for your own cryptographic estate is to treat the certificate as the asset-register entry, treat its notAfter field as a stated useful life, and then ask which anchors you are relying on past the point their signatures can be forged. The confidentiality wave of quantum cryptographic exposure, which dominates current attention, concentrates at scannable perimeters. The integrity wave, in contrast, is distributed across every component carrying a verifiable signature, so it surfaces only through inventory, not perimeter scanning.

              Attendees leave with a runnable method and an understanding of how to apply this to their own PKI estates.
            track: Demo
            speakers:
              - Tim D Williams
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

          - title: "Bootstrapping PQC on Existing Hardware: A Three-Stage Migration Framework"
            description: |
              The transition to post-quantum cryptography requires more than replacing algorithms. Public-key cryptography is deeply embedded in device identity, secure boot, code signing, certificate issuance, software delivery, and credential lifecycle management. For long-lived connected and industrial devices, immediate hardware replacement is often neither financially nor operationally practical.

              This presentation presents a three-stage migration framework for introducing PQC into existing device platforms while preserving current hardware roots of trust. In the first stage, symmetric cryptography and existing protected key storage are used to maintain secure boot and establish a trusted execution environment. In the second stage, that environment is used to generate, provision, and protect PQC credentials on the device. In the third stage, PQC credentials and the established boot chain are used to authenticate and deploy quantum-safe applications and software updates.

              The session will examine how this staged approach applies to constrained embedded devices and large, mixed-generation fleets. It will also address the operational challenges that determine whether such a migration can scale, including cryptographic agility, key protection, credential lifecycle management, rollback, code-signing evolution, and coexistence between classical and PQC-capable devices.

              The framework is based on practical experience designing PKI, secure boot, code-signing, and device-identity infrastructures for large populations of connected devices. It is intended for organizations that must begin PQC adoption before PQC-optimized hardware is broadly deployed. Attendees will leave with a concrete migration model for using existing hardware security capabilities to bootstrap PQC, introducing PQC credentials without replacing the entire installed base, and evolving PKI, secure boot, and software-signing infrastructures toward fully quantum-ready platforms.
            speakers:
              - Xin Qiu
            locations:
              - room_a

          - title: Leveraging Agentic AI for Automated CBOM Inventory and Crypto-Agility
            description: |
              Extracting Cryptographic Bill of Materials (CBOMs) from source code is a foundational pillar of the Post-Quantum Cryptography (PQC) transition. However, traditional security scanning methods fall short.

              The limitations of SAST and vulnerability tools include limited support for legacy or proprietary languages where old cryptography often hides; the high friction and overhead of deep Abstract Syntax Tree analysis, which is computationally heavy and slows down CI/CD pipelines; scaling bottlenecks from heavy reliance on DevSecOps teams for onboarding and configuration; and a static, reactive posture that identifies risks but does not facilitate active crypto-agility.

              Integrating agentic AI into CI/CD pipelines via the Model Context Protocol introduces a scalable and code-agnostic approach to CBOM management. Beyond inventory, agentic AI enables true crypto-agility in pipelines, verifying pull requests and even fixing obsolete cryptography.
            speakers:
              - Iván Fernández Mora
            locations:
              - room_b

          - title: "Bridging the Gap: A Hybrid TPM Strategy for Post-Quantum Virtual Smart Cards"
            description: |
              Though NIST finalized ML-KEM and ML-DSA some time ago, the industry is still facing a dilemma: how to secure hardware against future threats without waiting for silicon updates. While the Trusted Computing Group (TCG) released the TPM 2.0 Library Specification v185 in March 2026 with native PQC support, the reality of enterprise deployment is that most existing hardware remains on pre-PQC TPMs.

              This session moves beyond theoretical migration paths to dissect a real-world, production-grade implementation of a hybrid Virtual Smart Card architecture. We detail our transition from Microsoft's Virtual Smart Card ecosystem to a custom, standard TPM-based solution. The core of the discussion focuses on a stop-gap but robust hybrid model: leveraging software-based post-quantum algorithms (ML-KEM and ML-DSA) for cryptographic operations while utilizing the existing TPM for the secure storage of PQC private keys.

              We look at why hardware-based key protection is significantly more secure than software-based storage, comparing pure software key storage against TPM-sealed keys and the attack surface each presents (lateral movement, memory scraping, offline extraction), along with honest caveats about where the hybrid model still has gaps compared to fully native TPM computation. We then turn to key lifecycle management across mixed algorithm sets: generation, backup, rotation, and revocation, and what worked smoothly versus where the hybrid model introduces genuine complexity.

              The session concludes with a frank assessment of when to wait for native TCG v185 hardware, what it actually brings to the table, and what pitfalls to avoid during the transition. Attendees will leave with a concrete blueprint for implementing crypto-agility in constrained environments and criteria for deciding when to migrate from software-hybrid models to native TPM 2.0 v185 hardware based on threat modeling and resource availability.
            speakers:
              - Zsolt Makádi
            locations:
              - room_c

          - title: "A Pragmatic Strategy Behind PQC: 7 Decisions Every Enterprise Must Make Before Migration"
            description: |
              Organizations are rushing to inventory certificates, evaluate tooling, and launch discovery projects in preparation for post-quantum cryptography (PQC). But these activities often begin before the organization has answered the architectural and governance questions that determine what should actually change. The biggest obstacle to PQC readiness is no longer the cryptography; it is making the right organizational decisions before technology choices lock in years of unnecessary cost and complexity.

              This session presents a practical decision framework built around the seven strategic choices every enterprise should make before investing in PQC tooling or migration efforts. Rather than another discussion of algorithms or migration mechanics, attendees will learn how to establish a clear, executable roadmap using existing PKI investments, governance processes, and technical teams. The result is a strategy that reduces unnecessary spending, avoids premature implementation decisions, and creates a foundation for true cryptographic agility.

              Drawing from real-world enterprise PKI modernization engagements, this session demonstrates how organizations can prioritize business risk, define crypto agility objectives, align policy and architecture, and determine where inventories, assessments, and tooling actually fit within an overall PQC strategy. It covers why certificate inventory does not equal PQC readiness and where most programs go wrong, how to align business risk, governance, crypto agility, and PKI architecture before selecting technologies, and how to determine when tooling adds value and when it simply creates additional cost and complexity.

              Attendees will leave with a vendor-neutral framework they can immediately apply to reduce unnecessary spending, avoid premature implementation decisions, and build a foundation for long-term cryptographic agility.
            speakers:
              - Mark Cooper
            locations:
              - room_d

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_e
      - time: "15:00"
        title: Break

      - time: "15:30"
        sessions:
          - title: Comparing Cryptographic Inventory Requirements Across Industries
            description: |
              This panel explores the differences in the requirements on cryptographic inventory, and how they impact remediation efforts and migration priorities across industry verticals. Chaired by an expert in cryptographic posture management, the panel brings together representatives from finance, telecoms, energy, healthcare and transportation to determine what each sector actually needs.

              The panel explores whether a universal inventory model is realistic across such fundamentally different environments, or whether sector-specific approaches to PQC discovery, cryptography information exchange and prioritisation will ultimately emerge. It covers the challenges of on-boarding external inventory tools, mapping cryptographic dependencies, and how to evaluate different tools against the individual needs of each industry.

              The topic becomes particularly interesting cross-sector because financial institutions may have mature PKI governance and strong visibility into certificates and identity infrastructure yet still struggle to map cryptographic dependencies within internally developed applications and third-party SaaS ecosystems; OT-heavy sectors such as energy, manufacturing, and transportation may know their physical assets in extraordinary detail while lacking visibility into embedded cryptography within industrial control systems, field devices, firmware, and operational protocols; and telecoms providers face challenges associated with highly distributed network infrastructure, vendor equipment, and complex trust relationships across operational environments.
            track: Panel discussion
            speakers:
              - Itan Barmes
              - Sarah McCarthy
              - Lory Thorpe
              - Rouven Floeter
              - Sjors Kasbergen
            locations:
              - plenary

          - title: "CLM 2.0: What's Deployed, What's Broken, What's Next"
            description: |
              A year ago at the PQC Conference in Kuala Lumpur, this panel mapped the roadblocks on the path to post-quantum resilience. Twelve months on, the questions have shifted. Certificate lifetimes are collapsing toward 47 days. Post-quantum cryptography has moved from roadmap slide to operational planning under regulator and customer pressure. AI-driven workloads are beginning to demand identity at a scale traditional certificate lifecycle management was never built to support. Conversations inside CISO offices and architecture reviews have moved from strategy to deployment.

              This session reconvenes the original panel for an implementation-grounded follow-up. The aim is to move past the vision and into the field: what is actually running in enterprise production today, where the new operational load is causing real failures, and what is getting torn out and rebuilt. Discussion will surface specifics: observed automation maturity across enterprise estates, failure modes under accelerated renewal cadence, and the trade-offs that emerge when crypto agility, hybrid PQC, and machine identity converge inside the same stack.

              Most sessions on CLM and PQC remain at the level of strategy, principle, or capability inventory. This panel stays inside the operational reality: what works at scale, what fails first, and what the next architecture looks like once we accept that CLM is no longer an operations function but a control plane for trust. That reframe carries practical consequences: where policy lives, who owns PQC migration, how AI agent identities are issued and revoked at workload speed, and what resilience metrics should replace the older uptime-and-renewal dashboards.

              The conversation is structured around four working areas: the breaking point of current approaches in a 47-day world; PQC and crypto agility as an operational discipline rather than a research topic; the architecture of a trust control plane, including how AI and autonomous workloads fit; and the business and risk reframe needed to fund and govern the shift. Attendees will leave with a clearer sense of where peer organizations actually stand on automation, PQC readiness, and machine identity scale, a working definition of what CLM 2.0 demands in practice, and a sharper view of the most expensive blind spots hiding inside today's deployments.
            track: Panel discussion
            speakers:
              - Chris Bailey
              - Chris Hickman
              - Ganesh Mallaya
              - George Parsons
              - Roman Cinkais
            locations:
              - blue_hall

      - time: "16:15"
        sessions:
          - title: "120,000 Tasks: The Cryptography Was the Easy Part"
            description: |
              The integrated master schedule for one large enterprise's post-quantum migration grew past 120,000 discrete tasks. It was not a count of devices, certificates, or applications to upgrade. If it were, 120,000 would be small. The direct remediation work, the actual cutovers across every device and application, accounted for fewer than 30,000 tasks (a million-plus devices, systems, and apps grouped into upgrade batches).

              The remaining 90,000 or so tasks are the enablement system: inventory as a living capability, governance and reporting cadence, vendor lifecycle enforcement, testing and assurance, workforce change, ecosystem and partner alignment, and ongoing operations during the long hybrid period.

              Drawing on that 120,000-task plan (illustrative of complexity, not a universal count) and on three decades running high-stakes delivery programs such as national payments systems and federal health-records platforms, the talk turns to what actually governs whether such a program finishes. It is rarely the cryptography. It is the density of interdependencies: vendors waiting on internal teams, shared infrastructure that must be ready before application waves can move, regulatory deadlines colliding with finite engineering capacity. It is ownership, because cryptography is everyone's problem and therefore no one's, so the program needs a single accountable lead with authority across security, IT, engineering, procurement, and OT. It is workforce capacity, since the trained people a program needs at its peak in years four to eight cannot be conjured on demand. And it is funding that has to survive several budget cycles and more than one CISO. PKI realities sit inside this frame: certificate migration planned as waves rather than a single flag day, and PKI and HSM procurement and certification lead times treated as hard scheduling constraints.

              Attendees leave able to right-size and sequence their own program, separate a credible plan from a wishful timeline, argue for a single accountable owner and the governance to back one, build the board case for multi-year funding, and prioritize by risk so the program delivers measurable security gains in years one to three while the longer effort runs on.
            speakers:
              - Marin Ivezic
            locations:
              - plenary

          - title: "Adding PQ Capabilities to SSH Protocol: The Fedora Approach"
            description: |
              OpenSSH and libssh are 2 mostly widespread implementations of SSH protocol. Real-world requirements for PQ crypto causes writing significant patches to OpenSSH because of difference of the upstream and downstream requirements. libssh upstream is more binded to Fedora maintainers and lands the changes upstream.

              The talk covers key downstream changes in OpenSSH: using OpenSSL code, providing extra algorithms support, FIPS compatibility quirks, in OpenSSH, and corresponding changes in libssh.
            speakers:
              - Dmitry Belyavskiy
            locations:
              - blue_hall

      - time: "17:00"
        noTransition: true
        sessions:
          - title: Closing (Day 2)
            description: |
              Brief closing remarks for the red hall audience and a preview of Day 3.
            speakers:
              - Sven Rajala
            locations:
              - plenary

          - title: Closing (Day 2)
            description: |
              Brief closing remarks for the blue hall audience and a preview of Day 3.
            speakers:
              - Paul van Brouwershaven
            locations:
              - blue_hall

      - time: "17:05"
        title: "Networking & drinks"

      - time: "18:30"
        title: "End of day two"

    2026-12-03:
      - time: "08:00"
        title: Registration

      - time: "09:00"
        noTransition: true
        sessions:
          - title: "Welcome back — Day 3"
            description: |
              Final day framing for the red hall audience: what is ahead, and how to make the most of the last day before heading back into the real world.
            durationMinutes: 5
            speakers:
              - Paul van Brouwershaven
            locations:
              - plenary

          - title: "Welcome back — Day 3"
            description: |
              Parallel welcome and agenda highlights for the blue hall audience.
            durationMinutes: 5
            speakers:
              - Albert de Ruiter
            locations:
              - blue_hall

      - time: "09:05"
        sessions:
          - title: "Towards Coordinated Quantum Security in the Financial Sector: Risks, Priorities, and a Framework for Market Action"
            description: |
              The transition to quantum security in the financial sector is not only a technological undertaking, but also a coordination challenge for a highly interconnected global ecosystem. Misaligned transition efforts may create operational risks, including interoperability tensions across markets, infrastructures, and jurisdictions, prolonged reliance on quantum-vulnerable cryptography, inefficient duplication of effort, and ecosystem fragmentation.

              To address these risks, the Europol Quantum Safe Financial Forum, in collaboration with FS-ISAC and CFDIR, has proposed an operational framework for coordinated action. The framework focuses on identifying and prioritising critical use cases, structuring the transition through shared implementation waves, and defining three use-case-specific milestones to align sequencing and execution.

              This session examines that prioritisation framework and provides an update on the state of quantum security in the financial sector, relevant not only to financial sector professionals, but to the wider community as an early example of ecosystem-wide coordination and its associated challenges.
            speakers:
              - Jaime Gómez García
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "09:35"
        sessions:
          - title: "The European Roadmap on Post-Quantum Cryptography: Looking Back and Moving Forward"
            description: |
              In April 2024, the European Commission issued a Recommendation on Post-Quantum Cryptography (PQC), calling on Member States to adopt a coordinated and harmonized approach to the transition towards quantum-resistant cryptographic systems. This led to the establishment of a dedicated PQC workstream within the NIS Cooperation Group, co-chaired by France, Germany, and the Netherlands. Bringing together representatives from nearly all EU Member States, the workstream developed the European roadmap for the coordinated migration to PQC, published in June 2025.

              The workstream continues to support Member States by fostering collaboration, exchanging experiences, and addressing common challenges related to the transition to PQC. In this talk, we will review the progress made since the publication of the roadmap, discuss key developments and lessons learned, and provide an outlook on the remaining priorities and future activities of the workstream.
            speakers:
              - Stephan Ehlen
            locations:
              - plenary

          - title: Hybrid is a Redistribution of Risk, Not a Removal of It
            description: |
              The post-quantum migration debate routinely flattens "hybrid versus pure PQC" into a security question (one algorithm or two?) when it is really an operational architecture question about which class of failure your organisation is structured to handle.

              This talk reframes the choice. Hybrid for key exchange is largely settled: deploy it now. Hybrid for authentication is harder, and the costs depend on construction. Composite signatures buy atomicity by binding two algorithms into one credential, but the same atomicity removes component-wise recovery and undoes two decades of hash-agility infrastructure. Parallel approaches deliver dual-algorithm assurance without the binding, fitting how PKI has handled every previous algorithm migration.

              Drawing on a failure-mode analysis across twenty-five operational and cryptographic scenarios, the talk argues that for most enterprise authentication deployments, parallel is the better-fitting hybrid, and the conscious choice rarely defaults to it.
            speakers:
              - Michael Osborne
            locations:
              - blue_hall

      - time: "10:15"
        title: Break

      - time: "10:45"
        sessions:
          - title: "Scaling Quantum Safe: How HSBC Transitions from Early Momentum to Enterprise Execution"
            description: |
              Quantum Safe transformation is emerging as a critical strategic priority for financial institutions, though most organisations are still in relatively early stages of structured execution. This session shares HSBC's experience in evolving its Quantum Safe journey from a collection of early initiatives into a structured enterprise programme designed for long-term migration.

              As a global financial institution operating across complex technology landscapes, HSBC recognised that successful cryptographic transformation requires more than identifying vulnerable algorithms or testing new technologies. It requires alignment across business priorities, technology domains, governance structures, third-party ecosystems, operational processes, and future investment decisions. The session explores how HSBC approached this transition by consolidating existing insights, validating readiness, strengthening alignment across stakeholders, and creating the foundations for the next stage of execution: moving from awareness and experimentation into an enterprise transformation mindset, strengthening board-level visibility, and building the governance, ownership, and execution model needed for a multi-year journey.

              Rather than focusing only on technology change, this session highlights the organisational and strategic lessons behind scaling Quantum Safe adoption in a large financial institution.
            durationMinutes: 60
            speakers:
              - Antti Ropponen
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

          - title: To be announced
            description: |
              Session details will be announced soon.
            durationMinutes: 105
            locations:
              - room_a
      - time: "11:45"
        sessions:
          - title: Prioritising Financial Sector Use-Cases for Migration
            description: |
              The intricate web of interbank communications, transaction protocols, and shared infrastructure means no single financial institution can effectively navigate a successful Post-Quantum Cryptography (PQC) migration alone. The Quantum Safe Financial Forum (QSFF) was launched by Europol in 2024 and quickly established itself as the go-to authority for financial institutions grappling with the complexities of quantum-safe migration. The forum comprises experts from leading commercial banks, central banks, regulators and other financial entities.

              A dedicated Working Group within QSFF is actively developing an aligned roadmap: precisely defining the scope of each "use-case" for PQC implementation, establishing criteria for evaluating and prioritizing those use-cases, linking business contexts to the CIA triad, identifying concrete milestones, and balancing dependencies to ensure a synchronized rollout.

              This talk provides an overview of the Working Group's structure, its deliverables to date, planned next steps, and practical ways in which the audience can contribute to this vital initiative.
            speakers:
              - Sarah McCarthy
              - Sudha Iyer
            locations:
              - plenary

          - title: "PQC PKI: The Good, the Broken, and the Hybrid"
            description: |
              2025 was a year full of preparations for deploying PQC in practice. Standards, software libraries, HSMs, a lot of everything was updated to support PQC algorithms.

              PQC 2026 started with a lot of PQC capable components and a statement like, "It's OK to have not acted YET. 2026 will be the last time this can be said". At the end of 2025 and the beginning of 2026 was also the time for great confusion. As organizations started to ponder on the next practical steps, they had to make decisions on what algorithms to use, hybrid solutions or not, and in the case of hybrids what type of hybrid PKI. Have companies deployed PQC in production by now? The answer is yes, production deployment have started. Decisions have been made and some earlier thoughts had to be dismissed. This presentation will highlight PQC PKI choices and hierarchies based on some real world decisions.

              Architecture, algorithms, and combinations. What has been chosen and why. And maybe even more interesting, what didn't work and why? The presenters do not claim to have seen all PQC PKI deployments of 2026, but we have seen a few, and this is real world experience from those.
            speakers:
              - Tomas Gustavsson
              - Sven Rajala
            locations:
              - blue_hall

      - time: "12:30"
        title: Lunch

      - time: "14:00"
        sessions:
          - title: "Beyond the Handshake: Enhancing PKI with Out-of-Band Key Agreement"
            description: |
              Post-quantum cryptography (PQC) migration is accelerating, but it also exposes a deeper reality: cryptography can no longer be treated as a one-time design choice embedded in protocols. As standards evolve, organizations must prepare for a future where multiple cryptographic assumptions coexist and continuously change, while advances in automation and AI shrink the window to respond to emerging cryptographic risks.

              This talk introduces Out-of-Band (OOB) Key Agreement as a practical way to enhance PKI, establishing an independent cryptographic control layer that complements existing protocols such as TLS and IPsec. Rather than replacing in-band key exchange, OOB mechanisms derive additional authenticated symmetric keys through a separate, policy-governed channel rooted in PKI identity, enabling organizations to introduce new cryptographic methods, rotate algorithms, and respond to emerging threats without requiring changes to application or transport layers.

              In this model, PKI evolves from a foundational trust anchor into a central orchestrator of cryptographic policy and lifecycle management across multiple key establishment channels, enabling both resilience through diversity and operational simplicity in a post-quantum world.
            speakers:
              - Michele Mosca
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

          - title: PQC Regulation and Guidance Globally
            description: |
              PQC guidance varies by country and by industry. Some countries publish short policy papers, others provide detailed cryptographic recommendations, and even PQC migration handbooks. We are also seeing the development of sovereign PQC algorithms and standards. This tutorial gives an overview of the PQC and cryptographic guidance that is currently available, highlights common themes, and identifies significant differences.

              Designed for managers and technical architects planning for PQC migration, especially those working in multinational organizations. It is also suitable for policy makers and regulators to help them understand the changing global landscape, and developers of cryptographic products and services will also benefit.
            track: Tutorial
            durationMinutes: 60
            speakers:
              - Zygmunt Lozinski
            locations:
              - room_a

          - title: Quantum-Ready for BFSI in the ASEAN Region
            description: |
              This session shares real experience working with MODA and FSC in Taiwan, and DICT and BSP in the Philippines, to understand their guidelines and roadmaps for supporting the Taiwanese and Philippine BFSI sectors in migrating to PQC, starting from helping them become quantum-ready.

              It shares real use cases covering how large national banks plan to build a golden inventory, what should be considered when preparing them to start PQC inventory and assessment, and which approach and methodology they adopt to start the assessment and the journey of PQC migration. For example, most of the banks would only adopt an agentless tool for cryptographic asset scanning; the session looks at which areas they usually start with and how they manage the data afterwards, as well as the role of the national cybersecurity authority and the central bank in driving this.
            speakers:
              - Vivian Ma
            locations:
              - room_b

          - title: PQC Migration for European Public Institutions
            description: |
              Cryptanalytically Relevant Quantum Computing (CRQC) is approaching increasingly fast, as the latest developments in hardware, software, and the application of decrypting algorithms show. But where would adversaries with a CRQC find their first targets? The public sector, involving many different institutions with huge amounts of confidential information (from monetary and financial, through organizational and strategic, to health and security data) is home to high-value targets with data retention periods that make harvest-now-decrypt-later worth the effort.

              The complexity of IT systems, already heterogeneous between the different institutions and even more so between European countries, and the need for reliability and trustworthiness of this backbone of our societies, make migration a highly difficult undertaking. This is a challenge Q-PrEP is here to help tackle, in and with its community of cybersecurity agencies, public sector organizations, their private sector providers, and cybersecurity researchers on PQC and related aspects. A clear strategy, not unguided disruption of safety and secrecy, is needed and advanced by and within Q-PrEP.

              To give the audience an impression of the project and its community, the presentation by the Q-PrEP project team covers an introduction to the approach and measures taken by Q-PrEP; the Q-PrEP Community as the centerpiece of the project; integration of Q-PrEP into the European PQC ecosystem; key aspects of the PQC migration in European public organizations and services and how their representatives engage in Q-PrEP; and the direction of Q-PrEP's PQC roadmap for the public sector, Europe-wide.
            speakers:
              - Mathias Schumacher
              - Adrian Neal
            locations:
              - room_c

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_d

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_e
      - time: "14:30"
        sessions:
          - title: Post-Quantum Migration at Anduril
            description: |
              Anduril's post-quantum cryptography (PQC) migration is well underway. Our particular focus is on the most constrained, most possibly complicated signals environments in which to establish secure, modern communications infrastructure. In this talk, I survey the technical roadmap of Anduril Industries from no-PQC to full-PQC, with special emphasis on DDIL (Denied, Disrupted, Intermittent, and Limited) communication scenarios. This talk discusses organizational challenges, engineering roadblocks (and successes), ranging from early planning and implementation, to simulation testing, live field testing, and deployment roll-out. A special emphasis is on interoperability of protocols and cryptographic primitives, and how to effectively handle various international regulation jurisdictions, as well as a call for further, future collaboration in this space, especially on common standards across various standardization bodies.
            speakers:
              - Daniel Apon
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

          - title: Securing the Internet of Things for the Quantum Era
            description: |
              The rapid growth of the IoT has transformed critical sectors such as healthcare, transportation, manufacturing, energy, and smart cities. However, IoT security is deeply dependent on public key infrastructures (PKI) for device identity, authentication, certificate management, secure onboarding, key establishment, and firmware validation. The emergence of quantum computing threatens many of the public-key algorithms underpinning today's PKI, creating a long-term security risk for IoT deployments with constrained resources and long operational lifetimes.

              This talk focuses on the transition of IoT PKI towards PQC. It examines the implications of PQC for certificates, certificate chains, device provisioning, authentication protocols, secure updates, and lifecycle management at scale. Particular attention is given to the practical challenges of deploying larger post-quantum keys and signatures on constrained IoT devices and bandwidth-limited networks. The talk also covers hybrid certificates, crypto-agile PKI architectures, migration strategies, and interoperability with existing IoT security standards.
            speakers:
              - Shahid Raza
            locations:
              - room_b

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_c

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_d

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - room_e
      - time: "15:00"
        title: Break

      - time: "15:30"
        sessions:
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - blue_hall

      - time: "16:15"
        sessions:
#          - title: Collaborative Efforts to Support Migration to PQC
#            description: |
#              A panel discussion that shares examples of how over 55 different organizations have collaborated within the NCCoE Migration to PQC project, using cryptographic visibility to support risk management decisions for migration actions, and performing demonstrations using PQC for interoperability and benchmarking to inform PKI system owners on starting to use PQC algorithms.
#
#              A panel of NCCoE collaborators who have been working on implementing PQC algorithms in PKI systems (such as the US Government PIV card). Moderator to be announced.
#            track: Panel discussion
#            speakers:
#              - Bruno Couillard
#              - Ted Shorter
#              - Evgeny Gervis
          - title: To be announced
            description: |
              Session details will be announced soon.
            locations:
              - plenary

          - title: Practical Implementation of Hardware-Separated Composite Signatures for Large-Scale PKI During the PQC Migration Period
            description: |
              The transition to Post-Quantum Cryptography (PQC) presents a significant challenge for organizations operating large-scale Public Key Infrastructures (PKIs). While PQC standards are becoming available, replacing vast numbers of deployed hardware tokens such as smart cards remains operationally expensive and time-consuming.

              In this session, we present our implementation experience with the IETF LAMPS draft "Composite ML-DSA for Use in X.509 Public Key Infrastructure" in a hardware-separated environment for large-scale PKI migration. The approach combines existing smart cards holding traditional signature keys (e.g., RSA) with server-side Hardware Security Modules (HSMs) providing PQC signature capabilities (e.g., ML-DSA), enabling organizations to begin introducing PQC without requiring immediate replacement of end-user hardware. We discuss three representative risks observed during implementation and evaluation: cross-protocol signature composition, unintended reuse of composite-signature keys for single-algorithm signatures, and device impersonation across separated trust domains, and present a device-binding architecture that addresses them while maintaining compatibility with the IETF LAMPS composite signature framework.

              We also evaluate the potential operational impact of this approach using a large-scale PKI migration model involving tens of millions of certificates, and share architectural considerations, implementation experiences, and validation results from a prototype built using cloud-based HSM services and commercially available PKI smart cards.
            speakers:
              - Akane Suzuki
            locations:
              - blue_hall

      - time: "17:00"
        noTransition: true
        sessions:
          - title: Conference closing
            description: |
              The chairs bring the conference to a close with key takeaways, a call to action, and what comes next for the PKI Consortium's PQC work.
            speakers:
              - Paul van Brouwershaven
              - Albert de Ruiter
              - Sven Rajala
            locations:
              - plenary

      - time: "17:05"
        title: "End of day three — thank you for joining us!"
---

Quantum computers will soon break the cryptographic foundation of the modern enterprise. This is no longer a theoretical risk for cryptography experts to debate—it is an imminent business continuity crisis that every digital organisation must solve.

The **PQC Conference Amsterdam 2026** is the definitive global gathering for the post-quantum transition. The rules from NIST are finalized. The deployment phase is here. The question is no longer *if* you should migrate, but *how fast* and *what breaks* along the way.

This isn't just an awareness event. This is where the organisations leading the transition share **exactly how they are doing it**, what problem they have run into, and how they have addressed them. Three days of practitioner-level experience: actionable migration blueprints, off-the-record discussions, and the connections that will cut months off your delivery timeline.

{{< stat-grid class="my-5" >}}
stats:
  - number: "2,600+"
    label: "Prior Attendees"
  - number: "~75"
    label: "Speakers"
  - number: "50+"
    label: "Sessions"
  - number: "5th"
    label: "Edition"
{{< /stat-grid >}}

> **Join the community.** The conference is open to every organization preparing for the quantum transition and is completely free to attend. It is not limited to members of the PKI Consortium.
{.callout-info}

## A Conference Designed for the Entire Enterprise

Migrating an enterprise to post-quantum cryptography requires more than just engineers writing code. It requires budget, risk mandates, policy alignment, and technology procurement.

We have structured the 2026 agenda to serve the two distinct halves of a successful migration:

{{< cards >}}
card_style: bento
cards:
  - color: "bento-dark"
    image: "photos/ASP_1760.jpg"
    icon: compass
    title: "The Strategic Track"
    text: |
      For the C-Suite, Risk Officers, and PMOs. The Strategic Track focuses entirely on the *business* of migration.
      
      - **Regulatory Compliance:** Navigate NIS2, DORA, and evolving mandates.
      - **Budget & Scoping:** Estimate the true cost of a multi-year migration.
      - **Vendor Assessments:** Which platforms and HSMs are actually ready?
      - **Timeline Strategy:** Sequencing without breaking legacy applications.
      
      **Plenary / Red Hall**
  - color: "bento-darker"
    image: "photos/AME_0934.jpg"
    icon: terminal
    title: "The Technical Track"
    text: |
      For Architects, DevOps, and Implementers. Deep-dive sessions on the actual implementation of the new NIST standards.
      
      - **Crypto-Agility in CI/CD:** Pipelines that allow algorithm swapping.
      - **Hybrid Key Exchange:** Classical/PQC TLS handshakes.
      - **Certificate Automation:** Managing the collision of PQC sizes with 47-day limits.
      - **Hands-on Tooling:** Libraries ready for use today.
      
      **Parallel / Blue Hall**
{{< /cards >}}

## Why You Cannot Afford to Wait

{{< cards >}}
card_style: bento
cards:
  - color: bento-orange-pale
    icon: alert-triangle
    title: "The rules are finalized"
    text: "NIST has officially published ML-KEM, ML-DSA, and SLH-DSA. The deployment phase has begun. The blueprint is set."
  - color: bento-teal-pale
    icon: cloud
    title: "Harvest now, decrypt later"
    text: "Adversaries are collecting your encrypted traffic today. Every day you delay is another day of sensitive data permanently exposed to future quantum attacks."
  - color: bento-red-pale
    icon: gavel
    title: "Regulatory countdowns"
    text: "Auditors and regulators are turning guidance into mandates. Failing to demonstrate a cryptographic agility plan risks severe penalties."
  - color: bento-purple-pale
    icon: cpu
    title: "The automation collision"
    text: "Moving to 47-day certificate lifespans while manually handling complex PQC migrations is a recipe for catastrophic infrastructure outages."
{{< /cards >}}

## Free to Attend, Supported by the Community

The PKI Consortium believes that securing the world's digital infrastructure against quantum threats shouldn't be hidden behind expensive paywalls. 

**Attendance to the PQC Conference—whether in-person in Amsterdam or virtual—is 100% free.**

{{< cards >}}
card_style: bento
cards:
  - title: "Support the Mission"
    color: bento-green-pale
    image: "photos/ANN04967.jpg"
    icon: landmark
    text: |
      While tickets are free, running a global technical conference is not. While our main room can hold 800 attendees and the total venue many more, our total attendee capacity will depend on the available budget. If your organization finds value in our work, please consider making a voluntary donation or sponsoring the PKI Consortium.

      *Please note: Donations are entirely voluntary and are strictly separated from event attendance. A donation is a contribution to our ongoing mission, not a fee or payment for conference access.*
    links:
      - text: "Donate to the Consortium →"
        url: "/donate/"
        class: "btn-primary shadow-sm"
{{< /cards >}}

## Registration and Format

We offer two ways to experience PQC Amsterdam 2026. Register early, as our in-person capacity is strictly capped to the venue limits.

{{< cards >}}
card_style: bento
cards:
  - color: bento-blue-pale
    image: "photos/AME_0009.jpg"
    icon: users
    title: "In-Person (Amsterdam)"
    text: |
      Join us at the Meervaart. **For three days, the entire venue is ours.**
      
      - **Full 3-day venue access**
      - **7 capped breakout rooms** for off-the-record discussions
      - Direct, 1:1 networking sessions with regulators and peers
      - Catered lunches, coffee, and networking drinks
      - *Registration is Free. Seats are strictly limited.*
    links:
      - text: "Reserve In-Person Seat →"
        url: "register/"
        class: "btn-primary shadow-sm"
  - color: bento-blue-pale
    image: "photos/ANN05834.jpg"
    icon: globe
    title: "Virtual / On-Demand"
    text: |
      Can't make it to Amsterdam? Follow the transition globally.
      
      - **Live global livestreams** of Plenary and Technical tracks
      - Participate in real-time chat and Q&A
      - Post-event access to all recorded main-stage sessions
      - Download shared presentation decks and resources
      - *Registration is Free. Global access.*
    links:
      - text: "Register for Virtual Access →"
        url: "register/"
        class: "btn-outline-primary"
{{< /cards >}}

## Supported By

{{< sponsors-level sponsoring="Post-Quantum Cryptography Conference Amsterdam 2026" level="all" >}}

## Main Organizers

This conference was made possible through the support of the Post-Quantum Cryptography Working Group and the following organizations:

{{< figure src="organizational-support.jpg" >}}

## Program & Speakers

We don't select speakers based on marketing budgets. We select based on **depth of implementation experience**. You will hear directly from national cybersecurity agencies, NIST/ETSI members, enterprise architects running hybrid setups, and cloud security teams.

{{< cards >}}
card_style: bento
cards:
  - color: bento-teal-pale
    icon: calendar
    title: "The Agenda"
    text: "Our three-day agenda follows a deliberate arc: framing keynote → parallel workshops → synthesis panel. Session titles and confirmed speakers are updated progressively as the program is finalized."
    links:
      - text: "View the full agenda →"
        url: "/events/2026/pqc-conference-amsterdam-nl/agenda/"
        class: "btn-primary shadow-sm"
  - color: bento-orange-pale
    icon: mic
    title: "Call for Proposals (CFP)"
    text: "Share practical migration experience, implementation lessons, and real-world outcomes. Early submissions have a significantly higher chance of selection. All accepted speakers are subject to our strict **Zero Product Promotion Guarantee**—ensuring authentic insights, not sales pitches."
    links:
      - text: "Submit your proposal →"
        url: "/events/2026/pqc-conference-amsterdam-nl/propose/"
        class: "btn-outline-primary"
{{< /cards >}}
