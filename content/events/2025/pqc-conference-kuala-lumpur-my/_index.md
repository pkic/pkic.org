---
date: 2024-08-15T08:00:00Z
draft: false
title: Post-Quantum Cryptography Conference - October 28 - 30, 2025 - Kuala Lumpur, Malaysia
summary: |
  This premier three-day event begins with hands-on workshops, followed by two days of expert-led talks, panels, and breakout sessions. It attracts top executives, technical leaders, and practitioners from both the public and private sectors, all focused on shaping the future of cryptography.

aliases:
 - /pqcc

layout: single
outputs:
 - html
 - event-data
 - event-overlays
 - event-session
 - event-speakers
 - event-agenda

params:
  heroButton: 
    label: Don't be too late, Register Now (free)!
    link: /register

  heroTitle: Post-Quantum Cryptography Conference
  heroImage: sunset_at_kuala_lumpur.jpg
  heroImageCredit: YongBoi
  heroImageLicense: CC BY-SA 4.0
  heroImageLicenseURL: https://commons.m.wikimedia.org/wiki/File:Sunset_at_Kuala_Lumpur.jpg
  heroDescription: October 28 - 30, 2025 - Kuala Lumpur, Malaysia | Online

data:
  name: Post-Quantum Cryptography Conference
  draft: true
  timezone: Asia/Kuala_Lumpur

  # Locations with sessions in parallel -----------------------------------------
  locations:
    order: [plenary, breakout]
    plenary:
      color: black
      livestream: https://pkic.org/events/2025/pqc-conference-kuala-lumpur-my/livestream/#Plenary
    breakout:
      color: navy 
      livestream: https://pkic.org/events/2025/pqc-conference-kuala-lumpur-my/livestream/#Breakout

    2025-10-28:
      order: [room_1, room_2, room_3, room_4, room_5]
      room_1:
      room_2:
      room_3:
      room_4:
      room_5:

  # Speakers --------------------------------------------------------------------
  speakers:
    - name: Paul van Brouwershaven
      title: Chair PKI Consortium and Director of Technology at SSL.com
      bio: |
        Paul van Brouwershaven is a distinguished leader in cybersecurity with over two decades of experience specializing in Public Key Infrastructure (PKI). He currently serves as the Director of Technology at SSL.com. In addition to his role, Paul chairs the PKI Consortium and also leads its PQC Working Group. Prior to his current roles, Paul held the position of Director Technology Compliance at Entrust and was the Technology Solutions Director at GlobalSign.  

        Beyond his leadership roles, Paul is also the Owner of Digitorus, a specialized software development and consultancy company he founded in 2016. Digitorus focuses on PKI, Digital Signatures, and Trustworthy Systems. His extensive expertise in PKI is further highlighted by his past role as Vice Chair of the CA/Browser Forum, where he contributed to defining industry standards for digital certificates.
      social:
        linkedin: https://www.linkedin.com/in/pvanbrouwershaven/
        x: https://x.com/vanbroup
        github: https://github.com/vanbroup
        ietf: https://datatracker.ietf.org/person/paul.vanbrouwershaven@digitorus.com

    - name: Albert de Ruiter
      title: Vice Chair PKI Consortium and Policy Authority PKI Dutch Government (Logius)
      bio: |
        Albert de Ruiter operates the Policy Authority at Logius, the digital government service organization of the Netherlands. He is also a member of the QvC (Quantum Secure Cryptography) working group of the Dutch government, a board member of HAPKIDO, and a member of the PKI Consortium. Albert is known for introducing the idea of a Post-Quantum Cryptography Conference to the PKI Consortium in 2022.
      social:
        x: 
        linkedin: 

    - name: Michael Osborne
      title: CTO IBM Quantum Safe at IBM Research
      bio: |
        Michael Osborne is an IBM Distinguished Engineer and the global CTO for IBM Quantum Safe. He leads the cryptographic research activities at the IBM Research Center in Rüschlikon, Switzerland. His current focus includes advancing new generations of advanced cryptography, such as those selected by NIST as the next generation of PQC algorithms. He also leads the development of methods and technologies to help organizations migrate to use new Quantum-Safe standards.
      website: https://research.ibm.com/people/michael-osborne
      social:
        linkedin: https://www.linkedin.com/in/michael-osborne-qsafe/

    - name: Tan Wai Kaey
      title: IoT & Cybersecurity Engineer
      bio: |
        Tan Wai Kaey is an IoT and Cybersecurity Engineer with a strong academic foundation and professional certifications, including CEH (Certified Ethical Hacker), CC (Certified in Cybersecurity), and CCNA (Cisco Certified Network Associate). Her expertise includes penetration testing, vulnerability assessment, secure software development, and cryptography. She has contributed to projects involving secure web applications, database management, and lightweight post-quantum cryptographic solutions. As the former cybersecurity lead for the Google Developer Student Club (GDSC), she led workshops and initiatives to enhance technical skills and promote cybersecurity awareness.
      social:
        linkedin: https://www.linkedin.com/in/casey-tan-profile/

    - name: Basil Hess
      title: Senior Research Engineer at IBM Research
      bio: |
        Basil is a Senior Research Engineer at IBM Research Europe - Zurich. His focus is on the implementation side of cryptography, quantum-safe cryptography and quantum-safe migration.
        
        The projects he is involved include Open Quantum Safe - software for prototyping quantum-resistant cryptography, he's a co-author of CycloneDX CBOM (Cryptography Bill of Materials), and two submissions to the NIST PQC Standardization for additional digital signature schemes: MAYO and SQIsign.
        
        Basil holds a PhD in Information Systems and a MSc in Computer Science, both from ETH Zurich.
      website: https://research.ibm.com/people/basil-hess
      social:
        linkedin: https://research.ibm.com/people/basil-hess
        github: https://github.com/bhess

    - name: Octavian Maciu
      title: Hardware Product Manager at PQShield
      bio: |
        Octavian Maciu is a Hardware Product Manager at PQShield, where he contributes to the development and evolution of the company’s hardware offerings during a pivotal time for Post-Quantum Cryptography (PQC). With a background in hardware design, he brings a blend of technical expertise and product insight to the role.

        Before joining PQShield, Octavian worked on advanced semiconductor and hardware technologies at Qualcomm, and conducted research at the French National Centre for Scientific Research (CNRS). He holds a Master of Science in Micro and Nanoelectronics from the University of Strasbourg.

        At PQShield, his work focuses on enabling secure, efficient hardware implementations that meet the demands of quantum-resilient cryptographic standards.
      social:
        linkedin: https://www.linkedin.com/in/omaciu/

    - name: Tan Teik Guan
      title: CEO at pQCee
      bio: |
        Dr. Tan Teik Guan is the CEO and Co-founder of pQCee, a startup dedicated to helping organizations achieve post-quantum cryptographic readiness. A specialist in cryptographic security design and integration, he has led the implementation of secure systems for financial institutions, government agencies, and enterprises across Asia.

        Before founding pQCee, Dr. Tan spent over a decade at the helm of DS3, a multi-factor authentication solutions provider, which he led to a successful acquisition. His work bridges theoretical cryptography and real-world applications, earning him a trusted reputation in the field.

        He holds a BSc and MSc in Computer Science from the National University of Singapore and a PhD in Information Systems from the Singapore University of Technology and Design. He continues to be active in cybersecurity standards and policy development, with a strong interest in advancing quantum-resilient infrastructures.
      social:
        linkedin: https://www.linkedin.com/in/teikguan
        
    - name: David Hook
      title: VP Software Engineering at Keyfactor
      bio: |
        David has been working on Cryptography APIs and secure protocols since the mid-1990s and in IT and open-source since the mid-1980s. He is a founder and still active committer of the Legion of the Bouncy Castle Cryptography project which began in the year 2000 and provides APIs in Java, C#, and Kotlin. David founded Crypto Workshop, now part of Keyfactor, in 2012 in order to better support the Bouncy Castle APIs and its user community. Shortly after, he led the work on the FIPS certification of the Bouncy Castle APIs, resulting in their first certifications in 2016. His deep interest is in providing tools to simplify the development of solutions that make use of cryptography and secure protocols, with an emphasis on standards-based approaches. He is based in Melbourne, Australia.
      social:
        linkedin: https://www.linkedin.com/in/david-hook-29b720/

    - name: Alexander Löw
      id: alexander-loew
      title: CEO at Data-Warehouse
      bio: |
        Dr. Alexander Löw is the CEO of Data-Warehouse GmbH and serves as a Senator in the German Senate of Economy. He holds the position of Vice President of the German Cybersecurity Council Association and is the innovative mind behind IQIMS and PCert. With a deep understanding of cybersecurity since the 1980s and 25 years of experience as a Data Protection Officer (DPO), Alexander has a strong focus on Public Key Infrastructure (PKI). He has been involved in the conceptualization, building, and maintenance of industrial and governmental CAs (e.g., Macao, German Airforce, BMW) since 2001. In 2012, following a significant APT attack, he began automating PKI processes to enhance cybersecurity. Since 2014, he has been actively involved in publishing and presenting on PKI and cybersecurity topics, and has been conducting PKI trainings for the German BSI Alliance for Cybersecurity since 2015. In 2024, he joined the NIST Post-Quantum Migration Working Group to contribute to the development of standard 1800-38B.
      social:
        linkedin: https://www.linkedin.com/in/dr-alexander-loew/
    
    - name: Alexey Bocharnikov
      title: APAC Quantum Security Lead at Accenture
      bio: |
        Alexey, a Director at Accenture, brings over 15 years of expertise in cybersecurity strategy, risk management, quantum computing, and cryptography. He currently holds the position of APAC Quantum Security Lead and Director of Cyber Strategy at AN/Z.
        
        Prior to Accenture, Alexey honed his expertise at EY, contributing to the Global Innovation Quantum Technology Lab and leading Global Quantum Security efforts. Before EY, Alexey served as a County Information Security Officer at Deutsche Bank's Moscow Branch. 
        
        Alexey is a vocal advocate for best practices and proactive risk management in cyber strategy and quantum security. His thought leadership includes authoring articles, contributing to international reports, producing educational videos, and speaking at industry conferences.
        
      social:
        linkedin: https://www.linkedin.com/in/alexeybocharnikov/
        x: https://x.com/sumprior
          
    - name: Tomas Gustavsson
      title: Chief PKI Officer at Keyfactor
      bio: |
        Tomas Gustavsson is the chief public key infrastructure (PKI) officer at Keyfactor. He pioneered open-source public key infrastructure with EJBCA, now embraced by thousands of organizations. With a background in computer science, Tomas established EJBCA to fortify trusted digital identities globally. He advocates for cybersecurity through innovation, collaboration, and open-source principles.
      social:
        linkedin: https://www.linkedin.com/in/tgustavsson/

    - name: Shane Kelly
      title: Principal Crypto Architect at DigiCert
      bio: |
        Shane Kelly has worked on solving various software security problems for his customers, from bespoke embedded systems to large-scale cloud-based deployments. Mr. Kelly has spent over eight years implementing, integrating, and optimizing post-quantum algorithms.
        
        At DigiCert, Kelly provides secure, robust, customer-oriented post-quantum cryptography solutions. His focus is on making the transition from current cryptographic solutions to post-quantum solutions as simple as possible given the enormous challenges involved.
      website: https://www.digicert.com/blog/author/shane-kelly
      social:
        linkedin: https://www.linkedin.com/in/shane-kelly-bb61a154/

    - name: Sudha Iyer
      title: Head Cybersecurity Architect at Citi 
      bio: |
        Sudha Iyer is Head Cybersecurity Architect at Citi, a founding member of the FS-ISAC PQC group, and an international project leader at ISO for blockchain and smart contract security. She has 23 years of experience in cryptographic architecture and is deeply engaged in cross-sector cybersecurity forums and leads several cryptographic and data security standards efforts. 
      social:
        linkedin: https://www.linkedin.com/in/sudhaeiyer

    - name: Efstathia Katsigianni
      title: IBM Quantum Safe Project Executive at IBM Research & Development
      bio: |
        Dr. Efstathia Katsigianni works as an IBM Quantum Safe Project Executive in Berlin, Germany. She is also an IBM Quantum Ambassador and holds a doctoral degree in mathematics. Efstathia has 7 years of experience working in Cybersecurity with focus on cryptography, quantum-safe cryptography, public key infrastructures and automotive security as well as cryptographic key management solutions. In her current role, she works as part of IBM Research on innovative solutions and is responsible for their implementation for customers. 
      social:
        linkedin: https://www.linkedin.com/in/efstathia-katsigianni/

    - name: Navaneeth Rameshan
      title: Senior Research Developer at IBM Research
      bio: |
        Dr. Navaneeth Rameshan is a senior research developer at IBM Research - Zurich, focused on applied cryptography and cloud security. He is driven by building tangible solutions to real-world security challenges, with multiple contributions across IBM Cloud services including Key Protect, Hyper Protect Crypto Service, Secrets Manager, and the IBM Kubernetes Service.
        
        His work includes quantum-safe integrations across diverse stacks, scalable middleware for HSMs and private PKI systems, many of which are deployed and in production today. He has also led architectural efforts to enable seamless migration to post-quantum cryptography. With a hands-on, systems-level approach, he aims to bridge research and engineering to make quantum-safe security practical at scale.
      social:
        linkedin: https://www.linkedin.com/in/navaneeth-rameshan/

    - name: Greg Wetmore
      title: VP Software Development at Entrust
      bio: |
        Greg Wetmore leads the global team responsible for building and enhancing the digital security product portfolio at Entrust, such as the Identity, Data Security, and Critical Infrastructure solutions. Greg joined Entrust in 2000 and has held a number of leadership positions on the engineering team over that period. Greg is a key industry advisor and speaks regularly on topics like digital identity, IoT, Zero Trust and post-quantum security. Greg holds an Engineering degree from Queen’s University Kingston, Ontario, Canada.
      social:
        linkedin: https://www.linkedin.com/in/gregwetmore/

    - name: Jonathan Jackson
      title: Senior Director, Strategic Solutions at BlackBerry Malaysia
      bio: |
        Jonathan has over two decades experience in helping organisations across APAC and EMEA deal with the ever-evolving cyber threats across multiple sectors – including government, defense, intelligence, energy, health, critical infrastructure, finance and legal.   He specialises in cybersecurity, threat intelligence and digital forensics, and has an in-depth understanding of the ASEAN cybersecurity threat landscape – since being based in Kuala Lumpur since mid-2023. 
        
        In Jonathan’s role, he regularly advises ministers, boards and executives on how to manage, predict and prevent the threats to IoT, networks, applications, endpoints and people.  Currently he is dedicated to supporting Malaysia’s cyber-resilience initiatives and the establishment of BlackBerry’s new Cybersecurity Center of Excellence.  Jonathan also participates in the ASEAN Cyber Crime Task Force, facilitating public-private cyber capability.
        
        Jonathan has been with BlackBerry for over 12 years and was the Head of Security Advisory for BlackBerry ANZ before leading a team as Director of Engineering for Asia Pacific & Japan. Prior to this, he worked for Nokia where he held a number of roles focusing on security and digital transformation.
      social:
        linkedin: https://www.linkedin.com/in/jonathanjackson1/

    - name: Blair Canavan
      title: Director, Alliances at Thales
      bio: |
        Blair has 30+ years of IT cybersecurity sales, channel, marketing, and business development experience. Blair continuously expanded his cybersecurity and cryptographic expertise starting with Symantec and several cyber start-ups including Chrysalis-ITS (Thales), InfoSec Global, Crypto4A and since September 2019, back with Thales’ Global Technology Alliances team, including the Quantum cryptography portfolio. Blair recently represented the Canadian Forum for Digital Infrastructure Resilience (CFDIR) to articulate the standards and Government guidance at Mobile World Congress (MWC) in 2023. He is an avid presenter, start-up consultant, and IT industry contributor. Blair holds an Hons.BA from the University of Waterloo, and Wilfrid Laurier University, Ontario, Canada.  
      social:
        linkedin: https://www.linkedin.com/in/blair-canavan-5b708a2/

    - name: Giuseppe Damiano
      title: Vice President of Product Management for the HSM product offering at Entrust
      bio: |
        Giuseppe is currently the Vice President of Product Management for the HSM product offering at Entrust. With over 30 years of experience, he is a senior expert in developing and managing PKI solutions and infrastructures, data security, and electronic payment systems.

        Giuseppe is also an ETSI member. He has actively contributed defining one of the first technical API standard for Cloud Signature services. The standard was [adopted by the Cloud Signature Consortium and by ETSI](https://cloudsignatureconsortium.org/2019/04/02/etsi-collaboration/).

        Furthermore, he has contributed to write one of the first [proposal for Distributed Ledger Timestamp](https://www.ietf.org/id/draft-intesigroup-dlts-03.html) based on a standard PKI format and blockchain evidence. 
      social:
        linkedin: https://www.linkedin.com/in/gdamiano/

    - name: Bruno Couillard
      title: Co-Founder & CEO at Crypto4A
      bio: |
        Bruno Couillard is the CEO and co-founder of Crypto4A Technologies Inc., where he leads the development of cutting-edge crypto-agile and post-quantum cybersecurity solutions, including the QxHSM and QxEDGE. With over 35 years of experience in cryptography, key management, and quantum-safe technology, Bruno has worked extensively in both commercial and military applications.

        Previously, he co-founded Chrysalis-ITS and spearheaded the development of the Luna HSM, now a part of Thales. He also contributed to the creation of the PKCS#11 Standard. In addition to his entrepreneurial work, Bruno has served as a cryptographic evaluator for the Canadian Government and played a key role in the Canadian Cryptographic Modernization Program (CCMP).

        Bruno is an active board member of Quantum Industry Canada (QIC), co-chair of the Quantum Industry Developers and Users Working Group, and a member of the Canadian National Quantum Strategy committee. Through these roles, he continues to promote and shape a quantum-safe cybersecurity ecosystem.
      social:
        linkedin: https://www.linkedin.com/in/brunocouillard/

    - name: John Buselli
      title: Offering Manager at IBM Quantum
      bio: |
        John Buselli is an Offering Manager for the IBM Quantum Group and is currently focused on the development and delivery of IBM’s Quantum Safe Program.  
        In this role, he oversees product strategy, market development and customer-facing programs.  
        Since joining IBM Research in 2015, John has focused on cyber security, confidential computing, privacy-enhancing technologies, data governance and securing AI Analytic initiatives.
        He previously led a global team at IBM tasked with building an Information Governance/Compliance Practice within the IBM software organization.   
        His career has been focused on establishing and expanding initial markets, products and operations for early-stage software firms including Verity (purchased by HP), and KVS (acquired by Symantec) Princeton Softech (purchased by IBM) as well as senior leadership roles at Seer Technologies and Texas Instruments.
      social:
        linkedin: https://www.linkedin.com/in/johnbuselli/

    - name: Zsolt Rózsahegyi
      id: zsolt-rozsahegyi
      title: CEO at i4p informatics
      bio: |
        Zsolt Rózsahegyi is CEO and co-founder of i4p Informatics. He holds engineering degrees from the Technical University of Budapest and Carnegie Mellon University. Zsolt was previously founder and CEO of one of Europe’s first Qualified Trust Service Providers and played a key role in shaping Hungary’s electronic signature legislation. His expertise spans applied cryptography, PKI, timestamping, secure software development, and quantum-safe systems.
      social:
        linkedin: https://www.linkedin.com/in/zsoltrozsahegyi/

    - name: Nils Gerhardt
      title: Chief Technology Officer at Utimaco
      bio: |
        Nils Gerhardt has 20 years’ experience in the cyber security industry. In his current role, Nils is the Chief Technology Officer for Utimaco, a leading provider of cyber security solutions, and supervisory board member of ISITS AG. Before joining Utimaco, Nils worked at Giesecke + Devrient in various executive management roles with regional and global responsibilities in Germany, Canada, and the USA. As Chairman of the Board of GlobalPlatform, a global industry organization, Nils brought major companies together to define the standards for secure digital services and devices.
      social:
        linkedin: https://www.linkedin.com/in/nils-gerhardt-38b6691/

    - name: Somrak Petchartee
      title: Research Operations Manager, NT Telecom Public Company Limited
      bio: |
        Dr.-Ing. Somrak Petchartee is a seasoned researcher and engineer with over 30 years of multidisciplinary experience encompassing radio frequency (RF) design, high-performance computing with FPGA, robotics, embedded systems, sensor technology, and post-quantum cryptography. He earned his Doctor of Engineering from the University of the Federal Armed Forces, Munich, where his doctoral research addressed tactile sensing for object manipulation. He also holds a Master of Engineering in Computer Science from the Asian Institute of Technology and a Bachelor of Engineering in Telecommunications (First-Class Honors) from King Mongkut’s Institute of Technology Ladkrabang.

        Dr. Petchartee has held pivotal roles across academia, defense, and industry, leading advanced research initiatives at NT Telecom and contributing to collaborative projects in quantum sensing and Single Proton Detector in partnership with Thammasat University. His scholarly contributions span numerous publications in tactile sensing, intelligent systems, and quantum technologies. He is also a regular invited speaker at prominent technology and innovation forums across Asia.

        His work has been recognized with several prestigious awards, including the SEPO Thailand Innovation Award, the Best Paper Award from the Journal of Computers for his research on polynomial dynamic time wraping (DTW), and the Emerald Literati Award for Excellence. Dr. Petchartee remains committed to advancing secure and intelligent systems through interdisciplinary research and applied innovation.
      social:
        linkedin: https://www.linkedin.com/in/dr-ing-somrak-petchartee-34024136/

    - name: Ronny Döring
      id: ronny-doring
      title: R&D System Engineer at Deutsche Telekom AG
      bio: |
        Ronny Döring is an R&D System Engineer at Deutsche Telekom AG, T-Labs, with a focus on post-quantum cryptography and secure communication protocols. He coordinates experimental work in the T-Labs Quantum Lab and explores the practical integration of advanced cryptographic technologies.

        As part of the EU project OpenQKD, Ronny has demonstrated how quantum key distribution (QKD) and post-quantum cryptography (PQC) can be integrated into core network infrastructures, enhancing the resilience and future-readiness of digital communication systems. His research and implementation efforts aim to build a secure communications framework that combines both quantum and classical technologies to meet the challenges of tomorrow’s digital landscape.
      social:
        linkedin: https://www.linkedin.com/in/rnnydrng/

    - name: Frank Michaud
      title: Principal Enginer Tech Lead for Cisco Crypo Services at Cisco
      bio: |
        Frank Michaud has been the technical leader of Cisco Cryptographic Services (CS) since October 2022, playing a pivotal role within the Senior Tech Talent of the Cisco Security & Trust organization. He leads the Post-Quantum Cryptography (PQC) transition for CS, provides critical security guidance to Cisco Business Units, and pioneers innovative Public Key Infrastructure (PKI) solutions. Frank is widely recognized as a leading technical expert in the identity domain across the industry and serves as a technology advisor to Cisco's Security CTO.

        Since joining Cisco in 2016, Frank has been instrumental in driving innovation across IoT security, edge computing, identity management, authentication, and software security. His career, which began in 2000, includes significant contributions at leading security companies such as Kudelski Nagravision and NXP Semiconductors, where he developed foundational software solutions, hardware designs, and security architectures for highly sensitive domains.

        Frank has actively contributed to several standards bodies and consortia, including GlobalPlatform and IEEE. Over the course of his career, he has been the driving force behind 15 patents, demonstrating his sustained commitment to advancing security technologies and solutions. He has also presented at the RSA Conference (RSAC), where he addressed topics related to PQC.
      social:
        linkedin: https://www.linkedin.com/in/frankmichaud/
        x: https://x.com/fmiche76

  # Agenda ----------------------------------------------------------------------
  agenda:
    2025-10-28:
      - time: "8:30"
        title: Registration

      - time: "9:00"
        sessions:
          - title: Workshops
            description: |
              Workshops kick off the conference on Day 1, offering a focused environment for technical deep dives, practical training, expert roundtables, and hands-on exploration of post-quantum cryptography, secure architectures, crypto agility, and related topics.

              They run in parallel across multiple rooms, with smaller group sizes to encourage interaction. Registration is available on a first-come, first-served basis.
            speakers: 
              - TBD
            locations:
              - room_1

          - title: "PKI and Crypto Agility: Know Your Infrastructure"
            description: |
              _Building and Monitoring Your Cryptographic Inventory with PCert_

              This workshop offers a deep dive into cryptographic discovery and inventory practices essential for organizations aiming to establish robust CBOM (Cryptographic Bill of Materials) and SBOM (Software Bill of Materials). Participants will learn how to identify and catalog all cryptographic assets across complex environments, laying the foundation for a comprehensive and actionable cryptographic inventory.
              
              **We will explore:**

              * What needs to be discovered and collected to ensure full cryptographic visibility,
              * How to build a universal cryptographic inventory that supports ongoing operational and compliance needs,
              * Automation strategies for cryptographic management processes, including analysis, risk assessment, and prioritization aligned with the organizational context.
              
              Additionally, we will address the challenges of managing systems of systems and intricate network topologies. The workshop will compare agent-based and agentless approaches to cryptographic discovery, including real-world implementation examples highlighting trade-offs and success factors.
              
              Importantly, this session is designed to empower both technical teams and decision-makers. By reframing cryptographic challenges as data and asset management problems, the workshop reduces complexity and enables strategic engagement with existing technological capabilities.
              ___

              _To get the most out of this interactive experience, attendees are strongly encouraged to bring a laptop. Hands-on activities and guided tooling demonstrations will be included throughout the session._
            speakers: 
              - Alexander Löw
            locations:
              - room_2

          - title: To be announced shortly 
            description: This workshop will be announced shortly
            speakers: 
              - TBD
            locations:
              - room_3

          - title: To be announced shortly 
            description: This workshop will be announced shortly
            speakers: 
              - TBD
            locations:
              - room_4

          - title: To be announced shortly 
            description: This workshop will be announced shortly
            speakers: 
              - TBD
            locations:
              - room_5

      - time: "11:00"
        title: Break
        sponsor: 

      - time: "11:30"
        sessions:
          - title: Continuation of the morning workshop 
            description: The morning workshop continues until lunch.
            speakers: 
              - TBD
            locations:
              - room_1
              - room_2
              - room_3
              - room_4
              - room_5

      - time: "13:00"
        title: Lunch
        sponsor: 

      - time: "14:00"
        sessions:
          - title: To be announced shortly
            description: This workshop will be announced shortly
            speakers: 
              - TBD
            locations:
              - room_1

          - title: To be announced shortly 
            description: This workshop will be announced shortly
            speakers: 
              - TBD
            locations:
              - room_2

          - title: To be announced shortly 
            description: This workshop will be announced shortly
            speakers: 
              - TBD
            locations:
              - room_3

          - title: To be announced shortly 
            description: This workshop will be announced shortly
            speakers: 
              - TBD
            locations:
              - room_4

          - title: To be announced shortly 
            description: This workshop will be announced shortly
            speakers: 
              - TBD
            locations:
              - room_5

      - time: "15:30"
        title: Break
        sponsor: 

      - time: "16:00"
        sessions:           
          - title: Continuation of the afternoon workshop 
            description: The afternoon workshop continues until the end of the day.
            speakers: 
              - TBD
            locations:
              - room_1
              - room_2
              - room_3
              - room_4
              - room_5

      - time: "18:00"
        title: End of Day One
        sponsor: 

    # Wednesday -------------------------------------------------------------------
    2025-10-29:
      - time: "8:30"
        title: Registration

      - time: "9:00"
        sessions:
          - title: Opening
            description:
            speakers: 
              - Paul van Brouwershaven
              - Albert de Ruiter
            youtube: 
            presentation: 
            locations:
              - plenary

      - time: "9:30"
        sessions:
          - title: Keynote
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

      - time: "10:00"
        sessions:
          - title: Keynote
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

      - time: "11:00"
        title: Break
        sponsor: 

      - time: "11:30"
        sessions:
          - title: "PKI Agility and the Difference to Cryptographic Agility: Lessons from the Past and Present"
            description: |
              Cryptographic agility is often misunderstood as purely a technical problem. This presentation challenges that assumption, arguing that agility requirements are context-dependent, often organizational in nature, and ultimately a subset of broader organizational agility.

              We begin by classifying different types of PKI agility according to the need for being agile. This includes replacing the underlying cryptographic algorithms and why size matters,  re-issuing certificates, replacing certificates hierarchies, reacting to key compromise and migrating to quantum safety. Through concrete examples, we show how lack of agility impacts dimensions differently. Some of the lessons date back 20 years to the transition from RSA to ECC and the experience gained deploying hybrid systems in sensitive government projects. Other lessons are more recent, for example the hybrid secure-boot mechanism on the IBM mainframe.
            speakers:
              - Michael Osborne
            locations:
              - plenary

          - title: The internet is ready for some PQC certificates
            description: |
              The size of PQC certificate chains has thrown a wrench into plans to migrate to PQC. A full certificate chain using ML-DSA-65 will cause problems for some systems out there however there are alternatives. This talk explores those alternatives and argues that we should be using some PQC in our certificates right now. The talk will also explore what a future PKI could look like at the conclusion of NISTs additional signature competition.
            speakers:
              - Shane Kelly
            locations:
              - breakout

      - time: "12:00"
        sessions:
          - title: "Quantum Security in Practice: Lessons from a Dozen of Client Engagements"
            description: |
              The quantum threat is no longer theoretical, it’s becoming a strategic concern for cybersecurity leaders. This session shares insights from a dozen client case studies across industries and regions, highlighting how organizations are preparing for quantum risk in practical terms.
              
              Through real examples from field engagements, the talk explores how security teams are assessing quantum readiness, making critical decisions with incomplete information, and adapting to shifting standards under real operational pressures.
              
              Rather than focusing on abstract principles, the session offers a grounded look at quantum security in action. Designed to resonate with technically savvy professionals, the narrative blends foundational context with hands-on application, providing actionable takeaways for those navigating the evolving path toward post-quantum resilience.
              
            speakers:
              - Alexey Bocharnikov
            locations:
              - plenary

          - title: A Framework for Cryptographic Agility
            description: |
              Cryptography is no longer a "set it and forget it" component of software architecture. With the rapid emergence of post-quantum cryptographic standards and the constant discovery of new vulnerabilities, organizations face a growing need to adapt quickly without rewriting applications every time the cryptographic landscape shifts.
              
              This talk will focus on the practical aspects of designing cryptographic systems that enable organizations to transition to post-quantum cryptography in a crypto-agile manner. By embedding agility into the way cryptography is consumed through abstraction, policy, key lifecycle management, and pluggable backends, organizations can avoid costly re-architecture each time cryptographic standards evolve. The framework is modular and composable, allowing teams to adopt incremental levels of cryptographic agility. This allows organizations to evolve toward a truly agile posture at a pace aligned with their security, performance, and compliance needs.
            speakers:
              - Navaneeth Rameshan
            locations:
              - breakout

      - time: "12:30"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "13:00"
        title: Lunch
        sponsor: 

      - time: "14:00"
        sessions:
          - title: "ASEAN’s Post-Quantum Future: Securing Communications in an Era of Disruptive Change"
            description: |
              As [ASEAN](https://en.wikipedia.org/wiki/ASEAN) economies surge toward digital evolution. the foundation of secure communications is facing an existential challenge. The rise of quantum computing is an imminent reality that threatens to dismantle traditional encryption, leaving government data, diplomatic channels & commercial transactions vulnerable to unprecedented risks - including 'harvest now, decrypt later' threats. Discuss the profound implications of quantum computing on SEA's cybersecurity landscape and the urgent need for proactive preparation & public-private sector synergy. In a region of diverse technological maturity, escalating cyber threats & heightened geopolitical risk, building quantum-resilient communications is not only a technical necessity, it is fundamental to national security, economic stability & ASEAN’s collective digital sovereignty.
            track: Panel Discussion
            speakers:
              - Jonathan Jackson
            locations:
              - plenary

          - title: "The PQC Landscape: Protocols and Standards"
            description: |
              Following the initial announcement of three PQC standards by NIST in 2024, and the subsequent announcement of a fourth more recently and a fifth on the way, a global game of catch up has started among standards bodies to lift the protocols and algorithm applications out of the classical era into PQC. The presentation will look at the current state of standards efforts in regards to protocols and applications and provide some thoughts on how things are evolving and why,
            speakers:
              - David Hook
            locations:
              - breakout

      - time: "14:30"
        sessions:
          - title: A structured approach to the quantum-safe transformation
            description: |
              As the risk increases for a ‘cryptographically relevant quantum computer’ to appear, the high level of complexity, required time, and the required cost of a migration to adopt quantum-safe cryptography become apparent. Priorities for the quantum-safe migration need to become therefore clear and an organization-wide migration program needs to be set-up. This presentation will describe an approach to migrating to quantum-safe cryptography, drawing on real customer examples from different industries. It will explore the challenges of each stage and discuss some concrete steps taken in both strategic and technical dimensions. This presentation will describe a phased approach, starting with establishing awareness and  understanding of the quantum-impact on an organization, as well as the establishment of a structured model for an efficient transformation. It will also focus on where cryptographic monitoring and cryptographic agility elements fit into this journey.
            speakers:
              - Efstathia Katsigianni
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "15:00"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: "Real-World Readiness for PQC: Gaps, Gains, and Groundwork"
            description: |
              The migration to quantum safe algorithms have started. Many of the pieces needed to migrate are now there and can be used in practice, but there are still gaps so an organization's full use of PKI is not yet possible to migrate. The depth and width of this algorithmic migration is so vast that it will be continuous work for years to come filling in gaps as we go. This presentation will take a look at a number of practical use cases that has been tested and proven to work, as well as use cases where it is currently not possible to migrate. Standards, software, hardware and other components will be judged depending on their readiness or not, and of course some performance tests. Are you ready to get your hands dirty?
            speakers:
              - Tomas Gustavsson
            locations:
              - breakout

      - time: "15:30"
        title: Break
        sponsor: 

      - time: "16:00"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: Working on Quantum-Safe Encrypted Emails
            description: |
              In the presentation, we will share how we implemented PQC encryption of emails which can inter-operate between Microsoft Office365 and Google Gmail. We will describe the motivation, requirements, design and architecture of how email encryption can be achieved, and how key management is carried out seamlessly. The outcome is that we can start to protect emails against harvest-now-decrypt-later attacks.
            speakers:
              - Tan Teik Guan
            locations:
              - breakout

      - time: "16:30"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "17:00"
        sessions:
          - title: Closing remarks for day 2
            description: 
            speakers:
              - Paul van Brouwershaven
              - Albert de Ruiter
            locations:
              - plenary

      - time: "17:05"
        sessions:
        title: Networking

      - time: "19:00"
        title: End of Day Two

    # Thursday -----------------------------------------------------------------
    2025-10-30:
      - time: "8:30"
        title: Registration

      - time: "9:00"
        sessions:
          - title: "PQC Integration in HSMs: From Standards to Strategy"
            description: |
              With the release of NIST’s first set of post-quantum cryptographic standards, the conversation around quantum readiness has moved from research into execution. For organizations relying on hardware-based trust anchors, this shift raises immediate strategic and operational questions: What do these new standards mean for existing HSM deployments? How do performance, certification, and lifecycle planning change in a post-quantum world?

              This panel brings together senior leaders from major HSM vendors and PQC experts to provide a clear, business-relevant update on the state of post-quantum integration in hardware cryptographic modules. Building on insights from previous sessions in Austin and Amsterdam, the panel will outline how vendors are approaching the integration of PQC algorithms, what early performance benchmarks indicate, and where the roadblocks lie in certification, customer adoption, and operational interoperability.

              Attendees will gain a practical understanding of the timelines, trade-offs, and architectural considerations shaping the next generation of secure hardware, across both on-premises and cloud HSM landscapes. The discussion will also address how to prepare governance and procurement processes to accommodate cryptographic agility and ensure continuity of trust in regulated and high-assurance environments. 

              This session is essential for CISOs, CTOs, compliance leaders, and architects looking to align their cryptographic infrastructure with emerging quantum-safe mandates, without compromising on performance, reliability, or compliance.

              ---
              _This panel discussion runs for 55 minutes and continues in the next session block._

            track: Panel Discussion
            speakers:
              - Bruno Couillard
              - Giuseppe Damiano
              - Blair Canavan
              - Nils Gerhardt
              - Zsolt Rózsahegyi
              - John Buselli *
            youtube:
            presentation: 
            locations:
              - plenary

          - title: "Advancing Cryptographic Transparency: CBOM Standardization in CycloneDX"
            description: |
              As quantum-safe migration and supply chain security become critical priorities, the Cryptography Bill of Materials (CBOM) is emerging as a foundational concept and standard for cryptographic visibility and assurance. This session explores the standardization of CBOM within OWASP’s CycloneDX 1.6, highlighting its role in cataloging cryptographic assets and their dependencies, including PQC primitives and hybrids. It will also preview upcoming enhancements in CycloneDX 1.7, including standardized algorithm naming and improved interoperability for certificates and keys, both essential for quantum readiness and cryptographic agility. The talk will show how CBOM integrates into the broader xBOM ecosystem - spanning Software, Hardware, SaaS, AI, and Operations - to support unified cryptographic governance across complex environments.
            speakers:
              - Basil Hess
            locations:
              - breakout

      - time: "9:30"
        sessions:
          - title: "Continuation: PQC Integration in HSMs: From Standards to Strategy"
            description: |
              This session continues the panel discussion on PQC integration in HSMs, focusing on the evolving landscape from standardization efforts to real-world deployment strategies. 
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "10:00"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "10:30"
        title: Break
        sponsor: 

      - time: "11:00"
        sessions:
          - title: The ABCs (Accelerated, Better and Cheaper) to Cryptographic Resilience
            description: |
              The session covers practical priorities in the quantum readiness Journey for financial industry.
              This session provides a focused update for C-level leaders on the financial sector’s preparedness for post-quantum cryptography. It covers recent developments across NIST, IETF, PCI DSS, and other regulatory bodies, highlighting their impact on existing architectures and risk postures.
              We will examine sector-specific challenges, current sandbox and testing efforts, and practical collaboration options available to institutions. The session concludes with a tactical roadmap that CISOs and senior executives can use to align with upcoming mandates and reduce transition risk.
            speakers:
              - Sudha Iyer
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "11:30"
        sessions:
          - title: Overcoming Challenges in Post-Quantum Cryptography Adoption
            description: |
              With the release of standards for Post-Quantum Cryptography (PQC) algorithms, the cryptographic community faces a paradigm shift. Unlike RSA, ECC, and DH, which were often regarded as "silver bullets" due to their efficiency in key size, signature size, and performance, current PQC algorithms introduce significant challenges. 
              
              This session will explore the practical obstacles of integrating PQC algorithms into existing products and services. Topics include the use of embedded systems that leverage LMS or ML-DSA signatures to verify component integrity, and the implications for services delivering image signature solutions, particularly with regard to backend HSM operations and compliance with CNSA 2.0. Finally, we examine how open-source PKI management tools, purpose-built for PQC, can help meet these challenges by providing scalable and adaptable infrastructures for orchestrating post-quantum cryptographic operations.
            speakers:
              - Frank Michaud
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout


      - time: "12:00"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "12:30"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "13:00"
        title: Lunch
        sponsor: 

      - time: "14:00"
        sessions:
          - title: "Crypto-Agility: How it’s both a Critical Component and a Complex Challenge"
            description: |
              The time to prepare for the quantum threat is upon us, and the move from traditional crypto to PQC will touch just about every cryptographic system and piece of infrastructure. To make the transition, organizations need visibility into their cryptographic estate (hardware, software, keys, certificates, secrets, etc.) and ensure they have built in crypto-agility. How does one achieve a mature crypto-agile security practice? By defining crypto-agility and understanding what it looks like for your organization. But crypto-agility is much more than moving from one system or algorithm to another. It’s about people, processes and technology. It’s about visualizing your cryptographic assets, implementing policy, driving compliance and more. In this session, we’ll discuss in detail the necessary elements to achieve a mature crypto-agile security practice, and how to overcome the challenges to get there.
            speakers:
              - Greg Wetmore
            locations:
              - plenary

          - title: "Crypto Agility by Design: Securing PQC with Updatable HW/FW Co-design"
            description: |
              Hardware/firmware co-design provides a critical advantage in post-quantum cryptographic deployments by enabling agility against evolving threats. Unlike immutable hardware-only roots of trust-potentially vulnerable to future side-channel attacks and costly remediation-co-designed systems allow field updates to mitigate emerging vulnerabilities. Real-world incidents like Checkm8 highlight the risk of static hardware. In contrast, updateable firmware enables proactive responses, including SCA patching, parameter updates, and crypto migration. This talk explores how co-design enhances security lifecycle resilience, accelerates secure development, and supports crypto agility-vital for PQC in constrained, real-world environments.
            speakers:
              - Octavian Maciu
            locations:
              - breakout

      - time: "14:30"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: "Post-Quantum Firmware Signing in IoT: Practical PQC-FOTA Implementation"
            description: |
              As quantum computing advances, the cryptographic integrity of long-lived IoT devices is increasingly at risk. This presentation demonstrates a practical approach to securing Firmware Over-the-Air (FOTA) updates on ESP32-based IoT devices using Post-Quantum Cryptography (PQC).

              We explore how NIST-standardized digital signature algorithms-ML-DSA (FIPS 204, formerly CRYSTALS-Dilithium) and SLH-DSA (FIPS 205, formerly SPHINCS+)-can be integrated into the ESP32 secure boot process to replace classical RSA/ECDSA schemes. Using the Open Quantum Safe (OQS) library, we implement PQC signing on resource-constrained hardware and evaluate the trade-offs in performance, code size, and interoperability.

              The presentation features real-world deployment on ESP32 hardware, and includes practical guidance on hybrid signing approaches (e.g., ECDSA + ML-DSA) for maintaining backward compatibility. Tools such as ESP-IDF, PlatformIO, and custom signing scripts are used throughout.
            speakers:
              - Tan Wai Kaey
            locations:
              - breakout
            
      - time: "15:00"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: "Authenticity Guaranteed: Verifying Video Integrity on Consumer Devices with Post-Quantum Signatures"
            description: |
              As AI-generated video content becomes increasingly convincing, ensuring the authenticity of video material is more critical than ever. This session presents a novel method for verifying the integrity of video streams or files using post-quantum digital signatures. Designed for deployment on consumer devices, the approach safeguards against tampering and deepfake manipulation, even in a future where quantum computing threatens classical cryptographic schemes. Join us to explore the architecture, implementation, and real-world applications of this quantum-resistant solution for trusted video authentication.
            speakers:
              - Ronny Döring
            locations:
              - breakout

      - time: "15:30"
        title: Break
        sponsor: 

      - time: "16:00"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "16:30"
        sessions:
          - title: To be announced shortly
            description: |
              The speaker(s) for this session will be announced soon!
            track: 
            speakers:
              - TBD
            youtube:
            presentation: 
            locations:
              - plenary

          - title: Evaluating the Practical Capabilities of Contemporary Quantum Processors in Breaking AES Encryption
            description: |
              As quantum computing advances, assessing the potential of current architectures to threaten AES encryption is essential. This study evaluates leading quantum processors, IBM, Google, Zuchongzhi 2, Microsoft, Rigetti, IonQ, and Honeywell, focusing on quantum gate complexity, qubit coherence time, and scalability trade-offs. It demonstrates how these systems, when scaled to thousands of qubits with error correction, could compromise AES security. The findings offer clearer insight into the timeline of quantum threats, aiding in strategic planning for mitigation and PQC migration. Enhancing AES robustness through longer key sizes and hybrid models is also explored to strengthen cryptographic readiness.
            speakers:
              - Dr. -Ing. Somrak Petchartee
            locations:
              - breakout

      - time: "17:00"
        sessions:
          - title: Closing remarks
            description: 
            speakers:
              - Paul van Brouwershaven
              - Albert de Ruiter
            locations:
              - plenary

      - time: "17:00"
        title: End of Day Three

---

## Conference Details

From **Tuesday, October 28 to Thursday, October 30, 2025**, the PKI Consortium will host its fourth Post-Quantum Cryptography (PQC) Conference at the Connexion Conference & Event Centre in Kuala Lumpur, Malaysia.

This premier three-day event begins with hands-on workshops, followed by two days of expert-led talks, panels, and breakout sessions. It attracts top executives, technical leaders, and practitioners from both the public and private sectors, all focused on shaping the future of cryptography.

> The conference is open to all individuals interested in Post-Quantum Cryptography and is **not limited** to PKI Consortium members. 
{.callout-info}

## Date and location

**Date:** Tuesday, October 28 to Thursday, October 30, 2025  
**Location:** [Connexion Conference & Event Centre](https://connexioncec.com/), Kuala Lumpur, Malaysia  
**Registration:** [Click here](/register)

* _This event can be attended in-person or remotely, we strongly recommend to attend in person where possible._
* _Workshops can only be attended in-person._
* _There are no costs to register or attend the conference._
* _Travel, accommodation and living expenses are not covered, all attendees are responsible to cover their own expenses._

{{< button link="/register" target="_blank" label="Register for this conference" type="dark" >}}  

## Sponsors

We are immensely grateful to our sponsors:

{{< sponsors-level sponsoring="Post-Quantum Cryptography Conference Kuala Lumpur 2025" level="all" >}}

#### Become a Sponsor

**Interested in sponsoring the Post-Quantum Cryptography Conference?** For detailed information about sponsorship opportunities, please [contact us](/sponsors/sponsor/). You can also [download the sponsorship brochure](pqc-conference-kl-sponsors.pdf) for a comprehensive overview and pricing of our sponsorship packages.

{{< button link="pqc-conference-kl-sponsors.pdf" target="_blank" label="Explore our sponsorship opportunities" type="outline-success" >}}  

## Agenda

The conference features a balanced program with strategic, informational, and educational sessions in the Plenary room, and technical deep dives in the Breakout room. Attendees can look forward to keynote speeches, interactive sessions, and panel discussions led by Post-Quantum Cryptography (PQC) experts. To ensure a focus on education, speakers are not permitted to promote products or services during presentations.

> Please note that this is a **preliminary agenda** and is subject to change. Final details, including topics, abstracts, speakers, panels, workshops and time slots, will be updated here in the coming weeks and months, with **more speakers and panels to be announced**.  
> {{< button link="/call" target="_blank" label="Call for Abstracts - Submit a proposal for a talk, panel discussion, or workshop" type="outline-danger" >}}  
{.callout-warning}

{{< agenda "agenda" >}}

{{< sponsors sponsoring="Post-Quantum Cryptography Conference Kuala Lumpur 2025" level="Leader" height="20" max-width="60" >}}

Please note that speakers are not permitted to promote products or services during their presentations. While commercials, workshops, and pitches included commercial information, the primary focus of the conference remains on educational content.

This conference is made possible through the support of the Post-Quantum Cryptography Working Group and the following organizations:

{{< figure src="organizational-support.jpg" >}}

For more information about the conference, please contact the PKI Consortium at feedback@pkic.org.
