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
          - title: "Quantum Security in Practice: Lessons from a Dozen of Client Engagements"
            description: |
              The quantum threat is no longer theoretical—it’s becoming a strategic concern for cybersecurity leaders. This session shares insights from a dozen client case studies across industries and regions, highlighting how organizations are preparing for quantum risk in practical terms.
              
              Through real examples from field engagements, the talk explores how security teams are assessing quantum readiness, making critical decisions with incomplete information, and adapting to shifting standards under real operational pressures.
              
              Rather than focusing on abstract principles, the session offers a grounded look at quantum security in action. Designed to resonate with technically savvy professionals, the narrative blends foundational context with hands-on application—providing actionable takeaways for those navigating the evolving path toward post-quantum resilience.
              
            speakers:
              - Alexey Bocharnikov
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

          - title: "The PQC Landscape: Protocols and Standards"
            description: |
              Following the initial announcement of three PQC standards by NIST in 2024, and the subsequent announcement of a fourth more recently and a fifth on the way, a global game of catch up has started among standards bodies to lift the protocols and algorithm applications out of the classical era into PQC. The presentation will look at the current state of standards efforts in regards to protocols and applications and provide some thoughts on how things are evolving and why,
            speakers:
              - David Hook
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

          - title: "Advancing Cryptographic Transparency: CBOM Standardization in CycloneDX"
            description: |
              As quantum-safe migration and supply chain security become critical priorities, the Cryptography Bill of Materials (CBOM) is emerging as a foundational concept and standard for cryptographic visibility and assurance. This session explores the standardization of CBOM within OWASP’s CycloneDX 1.6, highlighting its role in cataloging cryptographic assets and their dependencies, including PQC primitives and hybrids. It will also preview upcoming enhancements in CycloneDX 1.7, including standardized algorithm naming and improved interoperability for certificates and keys, both essential for quantum readiness and cryptographic agility. The talk will show how CBOM integrates into the broader xBOM ecosystem - spanning Software, Hardware, SaaS, AI, and Operations - to support unified cryptographic governance across complex environments.
            speakers:
              - Basil Hess
            locations:
              - breakout

      - time: "9:30"
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

      - time: "11:30"
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

{{< sponsors sponsoring="Post-Quantum Cryptography Conference Kuala Lumpur 2025" level="all" height="20" max-width="60" rows=true >}}

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
