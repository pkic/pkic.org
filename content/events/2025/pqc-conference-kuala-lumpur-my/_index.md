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
 - event-speakers2 
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

    - name: Pieter Schneider
      title: Program Manager Quantum Secure Cryptography at Dutch Ministry of the Interior & Kingdom Relations
      bio: |
        Pieter Schneider works as Program Manager Quantum Secure Cryptography NL (QvC-NL) at CIO Rijk of the Ministry of the Interior & Kingdom Relations. Pieter has a broad background in the security domain and cybersecurity. In his current role, he manages the QvC-NL program, which aims to help the Netherlands manage the risks of quantum technology on cryptography in time.
      social:
        linkedin: https://www.linkedin.com/in/pietersdr

    - name: Muralidharan Palanisamy
      title: CSO  at AppViewX Inc
      bio: |
        Muralidharan Palanisamy is the Co-Founder and Chief Solutions Officer at AppViewX, where he leads enterprise solutions focused on scalable security automation, certificate lifecycle management, and crypto-agility. With over 20 years of experience in designing and delivering high-performance workload management systems for web-scale online banking and financial platforms, he brings a unique blend of practical systems engineering and forward-looking cryptographic strategy.
      
        His background includes building resilient infrastructure for high-availability, low-latency environments that demand airtight security and compliance. Muralidharan has led transformative initiatives across PKI modernization, TLS automation, and DNS-based trust models—working closely with Fortune 500 institutions navigating zero-trust, crypto-diversity, and now post-quantum readiness.
      
        As quantum computing accelerates, he advocates for a holistic approach to crypto transformation—where post-quantum migration intersects with operational resilience, automation, and real-world workload demands. He is a regular contributor to industry thought leadership and a passionate voice for secure, scalable, and agile trust frameworks in the post-quantum era.
      social:
        linkedin: https://www.linkedin.com/in/muralidharanpalanisamy/

    - name: Alessandro Amadori
      title: Cryptographer at TNO
      bio: |
        Alessandro Amadori is a cryptographer at TNO focusing on the migration to Post-quantum Cryptography. He holds a PhD from Eindhoven University of Technology in cryptographic implementations. He has contributed in several PQC migration projects like HAPKIDO, and is one a co-author of the second edition of the PQC migration handbook.
      social:
        linkedin: https://www.linkedin.com/in/alessandro-amadori-4b2149b8/

    - name: Sven Rajala
      title: International PKI Man of Mystery at Keyfactor
      bio: |
        An award winning seasoned cyber-security consultant with extensive subject matter expertise on PKI, automation of PKI/Signing Solutions, and containers. I have over 18 years of experience working in both the private sector and with federal government departments and agencies. I am frequently called upon to participate in client discussions, presentations, and seminars on topics including PKI, EJBCA, and PKI Devsecops. I also host the Key Master series by Keyfactor found on the YouTube Keyfactor Developers channel.
      social:
        linkedin: https://www.linkedin.com/in/international-pki-man-of-mystery/
        github: https://github.com/svenska-primekey

    - name: Corey Bonnell
      title: Industry Technology Strategist
      bio: |
        Corey Bonnell is a Technology Strategist at DigiCert. He has over 15 years of engineering experience in several domains with a deep focus on Public Key Infrastructure. Corey represents DigiCert in several standards organizations, such as the CA/Browser Forum, ETSI, and IETF. He has been involved in the standardization process of emerging standards relating to post-quantum cryptography and is a frequent participant in IETF post-quantum cryptography hackathons.
      social:
        linkedin: https://www.linkedin.com/in/coreybonnell/
        ietf: https://datatracker.ietf.org/person/corey.bonnell@digicert.com

    - name: Tadahiko Ito
      title: Senior Researcher
      bio: |
        Tadahiko Ito is a Senior Researcher at Intelligent Systems Laboratory, SECOM CO., LTD. His research at SECOM includes cryptographic protocols, policy management, cryptographic key management, and planning for PQC transitions. He is a member of the CRYPTREC (Cryptographic Technology Research Working Group) PQC Research Working Group. Since 2017, he has represented SECOM Trust Systems at the CA/B Forum. He has co-authored several IETF RFCs, including RFC 8813, RFC 9295, and RFC 9336, among other publications.
      social:
        linkedin: https://www.linkedin.com/in/tadahiko-ito-b1b674160/
        ietf: https://datatracker.ietf.org/person/Tadahiko%20Ito

    - name: Ganesh Mallaya
      title:  at AppViewX Inc
      bio: |
        Ganesh Mallaya is a Distinguished Architect at AppViewX, where he has helped revolutionize certificate lifecycle management (CLM) and PKI solutions for global enterprises. A member of the CA/Browser Forum and a Harvard-certified cybersecurity strategist, he serves as a trusted advisor to organizations on post-quantum cryptography (PQC), digital trust infrastructure, and CLM modernization across complex, regulated environments
      social:
        linkedin: https://www.linkedin.com/in/ganeshmallaya/

    - name: Danny Setyowati
      title: Student at Republic of Indonesia Defense University
      bio: |
        Cyber Defense Engineering Student from Republic of Indonesia Defense University
      social:
        linkedin: 

    - name: Kevin Hilscher
      title: Sr. Director, Product Management at DigiCert
      bio: |
        Kevin works at the intersection of IoT and cybersecurity. Kevin is the product leader for the DigiCert Device Trust portfolio of products, focused on securing the Internet of Things (IoT). Kevin’s passion is for building platforms and device software for securing connected products, helping customers focus on building a superior connect product and not security “plumbing”. Kevin routinely speaks at industry conferences on the topic of IoT, product security, post-quantum cryptography (PQC), and IoT cybersecurity regulations. Kevin came to DigiCert from Microsoft Azure IoT, where he spent 7 years working with IoT customers, helping them build and secure connected products. 
      social:
        linkedin: https://www.linkedin.com/in/kevinhilscher/

    - name: Jing Yan Haw
      title: Senior Research Fellow at Centre for Quantum Technologies, National University of Singapore
      bio: |
        Dr. Jing Yan Haw is a Senior Researcher and technical lead at the National Quantum-Safe Network (NQSN), Centre for Quantum Technologies, National University of Singapore. With over a decade of experience in quantum science, he focuses on quantum key distribution (QKD), quantum security validation, and quantum-safe standards. He serves as an editor for the IMDA-TSAC Quantum Communication Networks Task Force and as a committee member of the Singapore Computer Society’s Quantum Technology SIG. He also contributes to ITU-T Q15/17 “Quantum-based Security” and ETSI ISG QKD standards. Dr. Haw earned his PhD from the Australian National University in experimental quantum communication and has published in Nature Photonics, Nature Communications, PRX Quantum, and Optica.
      social:
        linkedin: https://www.linkedin.com/in/jing-yan-haw-11657250/

    - name: Hao Qin
      title: Senior Research Fellow at Centre for Quantum Technologies, National University of Singapore
      bio: |
        Dr. Hao Qin is a senior researcher in National Quantum-Safe Network, affiliated with Centre for Quantum Technologies, National University of Singapore. He serves as the co-chair of the Quantum Communication Networks Task Force under Singapore's IMDA, vice chair of the Joint Coordination Activity on Quantum Key Distribution Networks and associate rapporteur for Q15/17 "Quantum-based Security" under the UN’s ITU. His research focuses on the practical aspects of quantum communication networks, including implementation security and testing evaluation, network and key management, use cases and applications, as well as standardization and certification.
      social:
        linkedin: https://www.linkedin.com/in/hao-qin-18888r/?originalSubdomain=sg

    - name: Udara Pathum
      title: Senior Software Engineer at WSO2
      bio: |
        Udara Pathum is a Senior Software Engineer at WSO2, leading initiatives in post-quantum cryptography (PQC) since 2023. He focuses on integrating PQC algorithms into real-world identity and access management (IAM) and public key infrastructure (PKI) systems, ensuring they are future-ready against quantum threats. Udara has authored several articles sharing real-world insights on PQC integration, hybrid cryptographic transitions, and adoption strategies. His goal is to help organizations future-proof their security infrastructure without disrupting existing systems.
      social:
        linkedin: https://lk.linkedin.com/in/hwupathum

    - name: Reza Azarderakhsh
      title: CTO at PQSecure and FAU
      bio: |
        Dr. Reza Azarderakhsh is a Professor at Florida Atlantic University and the CEO of PQSecure Technologies. He is a leading expert in post-quantum cryptographic engineering, specializing in secure hardware/software co-design, side-channel protections, and formal verification. Dr. Azarderakhsh has published over 140 papers in top-tier conferences and journals related to post-quantum cryptography, contributing significantly to national and international efforts in quantum-safe security for embedded and constrained systems.
      social:
        linkedin: https://www.linkedin.com/in/reza-azarderakhsh-39777042/

    - name: Andrew Cheung
      title: President & CEO at 01 Communique Laboratory Inc.
      bio: |
        Mr. Cheung boasts over 25 years of invaluable experience as a Chief Executive Officer and Chief Technology Officer. Throughout his illustrious career, he has consistently spearheaded cutting-edge innovations, and driven product
        development, resulting in a portfolio of 9 patents within the computer software industry. Notably, his outstanding contributions were recognized with a nomination for the prestigious Ernst and Young Entrepreneur-Of-The-Year award in 2001.
        
        Since founding his company in 1992, Andrew has positioned himself as a technology pioneer in Post-Quantum Cybersecurity and Remote Access technologies.   With over 15 years of hands-on experience and extensive expertise in patent application, prosecution, and litigation processes, he has established himself as a formidable force in the field.
        
        He remains at the forefront of technological advancements, with his latest innovation focusing on cybersecurity.  His groundbreaking work in Post-Quantum Cryptography (PQC), leveraging NIST-approved quantum-resistant algorithms, is a testament to his forward-thinking approach.  By combining his PQC engine with patent-protected measures into a wide array of applications, including cryptocurrencies, emails, and AI machine learning systems.  This proactive approach ensures robust protection against potential cyber threats posed by quantum computers, thereby safeguarding the integrity of classical computer systems as we know them today. 
      social:
        linkedin: https://www.linkedin.com/in/andrew-cheung-a7b8ba5/

    - name: Stefan van den Berg
      title: Researcher Cryptography and Cyber Security at TNO
      bio: |
        Stefan van den Berg is a cryptographer at the department Applied Cryptography and Quantum Algorithms at TNO. He has a background in information security and embedded systems. His work focuses on development of various Privacy-Enhancing Technologies, Post-Quantum Cryptography solutions and Quantum Applications.
      social:
        linkedin: https://www.linkedin.com/in/stefan-van-den-berg-3aa2b0129/

    - name: Sven Konings
      title: Software Developer
      bio: |
        Konings is a Software Developer at ZYNYO, working on digital signatures. As part of the HAPKIDO project he is working on the transition to quantum-safe digital signatures. Sven studied at the University of Twente and graduated in both masters Computer Science and Science Education and Communication."
      social:
        linkedin: https://www.linkedin.com/in/svenkonings/

    - name: Tony Chen
      title: Solutions Engineer
      bio: |
        Meet Tony Chen, the cybersecurity wizard with over 9 years of PKI magic up his sleeve! As an Asia-Pacific and Japan Solution Engineer at Keyfactor, he’s the go-to guy for all things secure and know-how of solutions to keep the digital world safe and sound.
      social:
        linkedin: https://www.linkedin.com/in/tony-chen-he/

    - name: Chris Hickman
      title: Security Officer
      bio: |
        As Chief Security Officer at Keyfactor, Chris Hickman is at the forefront of advancing the company’s position as a leader of digital trust security solutions in the technical landscape of cryptographic infrastructure and digital certificates. With extensive experience in smart card management systems, PKI design, and directory services, Chris is committed to integrating the voice of the customer into Keyfactor’s platform to drive innovative solutions and accelerate digital trust in the evolving security landscape. He spearheads Keyfactor’s post-quantum cryptography (PQC) strategies to support organizations in their quantum-readiness journeys. He remains an industry-wide trusted resource on enhancing digital trust through SaaS-delivered PKI solutions and certificate lifecycle automation software to support security teams of modern enterprises. 
      social:
        linkedin: https://www.linkedin.com/in/chrishickman613/

    - name: Lim Huck Hai
      title: Managing Partner - Consulting at Baker Tilly Malaysia
      bio: |
        Huck Hai is leading a team of PKI, PQC and AI professionals at Baker Tilly and is a founding member of ACPMIT, based in Budapest, Hungary.  Throughout his career, Huck has led numerous WebTrust for Certification Authorities audits, successfully delivered under KPMG, BDO, and now Baker Tilly. He is an active member of the Institute of Chartered Accountants in England and Wales (ICAEW) Tech Faculty Board and serves as the elected President of the Association of Certified Fraud Examiners (ACFE) - Malaysia Chapter. Huck has played a significant role in collaborating with authorities on National Root CA, Post-Quantum Cryptography (PQC), Cybersecurity, and Artificial Intelligence (AI). He was engaged by the Government of Malaysia in the implementation of the Digital Signature Act 1997 and Digital Signature Regulations 1998.
      social:
        linkedin: https://www.linkedin.com/in/huckhai-lim-847234a/
 
    - name: Anurag Krishna Sharma
      title: Scientist  at Advanced Data Processing Research Institute 
      bio: |
        I am a Theoretical Computer Scientist working with the Department of Space, Government of India, where I focus on high-assurance systems, secure communication protocols, and advanced computational models. My expertise spans Network Security, Post-Quantum Cryptography, Generative AI, and Quantum Networking, with practical implementation experience using Qiskit, OpenQASM, and IBMQ.
        
        I previously collaborated with AIIMS (All India Institute of Medical Sciences) to enhance healthcare infrastructure through technological innovation—particularly in secure data systems and intelligent diagnostics.
        
        I hold a Master’s degree in Computer Science from IIT Delhi, where my academic research explored the intersection of cryptographic theory and real-world systems, with applications in quantum-secure communication and privacy-preserving architectures.
      social:
        linkedin: https://www.linkedin.com/in/anurag-sharma-099798134/

    - name: James Howe
        title: Head of Cryptography at SandboxAQ
        bio: |
          Dr James Howe leads the cryptography team at SandboxAQ, overseeing its researchers and serving as the company’s subject matter expert on cryptography. He drives research and guides the design and enhancement of SandboxAQ’s cybersecurity products, with a focus on post-quantum cryptography, cryptographic modernization, and strengthening compliance and risk management capabilities. He is an author of SDitH, a NIST PQC signature scheme candidate, and serves as vice-chair of the ETSI Quantum-Safe Cryptography working group. For more than 10 years, his research has focused on hardware and software implementations, side-channel security, and the practical application of advanced cryptography.
        social:
          linkedin: https://www.linkedin.com/in/jameshowe1729/

    - name: Olivier Couillard
      title: Technical Product Manager at Crypto4A Technologies, Inc.
      bio: |
        Olivier joined Crypto4A seven years ago and has since contributed to nearly every facet of the HSM platform. His work spans from RNG design and entropy assessment to firmware development, key management applications, and even web UI implementation. In addition to his technical expertise, Olivier has collaborated with a wide range of customers and has been actively involved in the FIPS 140-2 and 140-3 certification processes.
      social:
        linkedin: https://www.linkedin.com/in/olivier-couillard-30627459/

    - name: Inigo Barreira
      title: ETSI ESI Vice Chair at Sectigo
      bio: |
        Inigo Barreira is the ETSI ESI Vice Chair and a senior compliance engineer at Sectigo.  Inigo has more than 20 years of experience running root programs and ensuring CA compliance. 
      social:
        linkedin: https://www.linkedin.com/in/inigo-barreira-107690/

  # Agenda ----------------------------------------------------------------------
  agenda:
    2025-10-28:
      - time: "8:30"
        title: Registration

      - time: "9:00"
        sessions:
          - title: "Advancing CBOM: Hands-On with CycloneDX v1.7 and PKI Extensions"
            description: |
              _The Linux Foundation CBOM with ClycloneDX_

              The CBOM workshop will help participants understand and become familiar with the  upcoming extensions to the CycloneDX CBOM standard v1.7. In particular new extensions targeted at reporting PKI certificates. We are actively talking to industry vendors who have expressed interest in collaborating on this workshop.
              
              **We will explore:**

              * Use open-source software recently transferred to the Linux Foundation.  The software will be used as a basis for a hands-on section of the course.
              * Become familiar with the  upcoming extensions to the CycloneDX CBOM standard v1.7
              ___

               _To get the most out of this interactive experience, attendees are strongly encouraged to bring a laptop. Hands-on activities and guided tooling demonstrations will be included throughout the session._
            speakers:
              - Michael Osborne
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

          - title: "Enabling Quantum-Safe, Crypto -Agile Security with Crypto4A's QxHSM™: Business & Technical Insights"
            description: |
              As quantum computing threatens modern cryptography, organizations must prepare their infrastructure for a post-quantum world. Hardware security modules (HSMs) — key to digital trust — must evolve. This workshop covers the strategic and technical foundations of quantum-safe security, focusing on Crypto4A’s 5th-generation QxHSM™.

              **We will explore:**
              
              * Part 1: Business Imperatives (2 hrs) - Explore drivers behind PQC adoption, including regulations, risk mitigation, and use cases like harvest-now-decrypt-later. Learn what defines a quantum-safe HSM and how QxHSM™ supports crypto-agility, reduces complexity, and ensures trust and compliance.
              * Part 2: Technical Foundations (1.5 hrs) - Dive into PQC integration, key management, and secure HSM architecture. A live demo of QxHSM™ highlights key creation, usage, policy control, and agility.
              
              Join us to learn how to future-proof your cryptographic systems using quantum-safe security that’s built in — not bolted on.
            speakers:
              - Bruno Couillard
              - Olivier Couillard
              - Robert Grapes
            locations:
              - room_3

          - title: Securing the future Internet of Things with ML-KEM and ML-DSA
            description: |
              Today's Internet of Things (IoT) relies on a variety of protocols and communications technologies…CoAP, LwM2M, LoRaWAN, NB-IoT, Wi-Fi, Thread … many of which are not quantum-safe. 
              
              While large-scale quantum computers capable of breaking current encryption aren't yet available, the concept of ""harvest now, decrypt later"" is a significant concern. Now that NIST has released final versions of its first three Post-Quantum Cryptography (PQC) standards the race is on to make IoT quantum-safe.
              
              **We will explore:**

              * Learn what it takes to make an MQTT-based IoT solution quantum safe. 
              * Implement and transmit data between a device and an MQTT broker using MQTT with TLS 1.3, ML-KEM, and ML-DSA using open-source tools. 
              ___
              
              _In order to fully participate in this workshop you will need a Ubuntu 22.04 (arm64 or x64) virtual machine capable of running Mosquitto MQTT broker, Wireshark and some client tools (2-4GB RAM, 15-20GB disk)._
            speakers:
              - Kevin Hilscher
            locations:
              - room_4

          - title: Create your own quantum-safe signed PDF documents with hybrid cryptography
            description: |
              This workshop is from a collaborative effort between TNO and Zynyo. Standards are now established and libraries are being released, the integration of Post-Quantum Cryptography into products is increasing. However, the adoption of PQC is not yet universal across all scenarios and use-cases. This workshop provides a unique opportunity for participants to create signed PDF documents using hybrid PQC using software DSS that creates digital signatures based on ETSI standards in line with European legislation such as the eIDAS regulation.  

              **We will explore:**

              * Participants will sign PDF documents using different types of hybrid certificates,
              * validate signatures to confirm their authenticity and integrity, 
              * Visualize signed PDFs and have tangible proof of their validity.
              ___

              _To get the most out of this interactive experience, attendees are strongly encouraged to bring a laptop. Hands-on activities and guided tooling demonstrations will be included throughout the session._
            speakers:
              - Alessandro Amadori
              - Sven Konings
              - Stefan van den Berg
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

          - title: "Hands-On PQC Migration: From Cryptographic asset inventory to PQC Crypto-agility"
            description: |
              With NIST setting a clear 2030 deadline for the deprecation of RSA and ECC in favor of quantum-safe algorithms, organizations face an urgent need to assess and modernize their cryptographic landscape. This workshop offers a practical, end-to-end session on post-quantum cryptography (PQC) migration—starting with cryptographic asset discovery and inventory, through quantum risk assessment, and culminating in the replacement of legacy algorithms with NIST-approved PQC standards.

              **We will explore:**

              * Create a PQC PKI and hybrid PKI using EJBCA, 
              * Issue a signing certificate to SignServer, and demonstrate how to integrate with a hardware security module (HSM) to secure cryptographic keys and operations—bridging the gap between proof of concept and real world deployment. 
              * Demonstrate cryptographic asset monitoring and automatic cryptographic migration using Keyfactor solutions, 
              * Highlight the key steps for PQC transition at scale and with agility.

              This session will equip you with the tools and strategies needed to future-proof your quantum safe cryptographic infrastructure.
              ___

              _To get the most out of this interactive experience, attendees are strongly encouraged to bring a laptop. Hands-on activities and guided tooling demonstrations will be included throughout the session._
            speakers: 
              - Tomas Gustavsson
              - Chris Hickman
              - Tony Chen
            locations:
              - room_2

          - title: "Enabling Quantum-Safe, Crypto -Agile Security with Crypto4A's QxHSM™: Business & Technical Insights"
            description: |
              As quantum computing threatens modern cryptography, organizations must prepare their infrastructure for a post-quantum world. Hardware security modules (HSMs) — key to digital trust — must evolve. This workshop covers the strategic and technical foundations of quantum-safe security, focusing on Crypto4A’s 5th-generation QxHSM™.

              **We will explore:**
              
              * Part 1: Business Imperatives (2 hrs) - Explore drivers behind PQC adoption, including regulations, risk mitigation, and use cases like harvest-now-decrypt-later. Learn what defines a quantum-safe HSM and how QxHSM™ supports crypto-agility, reduces complexity, and ensures trust and compliance.
              * Part 2: Technical Foundations (1.5 hrs) - Dive into PQC integration, key management, and secure HSM architecture. A live demo of QxHSM™ highlights key creation, usage, policy control, and agility.
              
              Join us to learn how to future-proof your cryptographic systems using quantum-safe security that’s built in — not bolted on.
            speakers:
              - Bruno Couillard
              - Olivier Couillard
              - Robert Grapes
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
          - title: "Scaling Trust: CLM Roadblocks on the Path to Post-Quantum Resilience"
            description: |
              As enterprises prepare for post-quantum cryptography (PQC), the ability to discover, manage, and transition cryptographic assets at scale has become a mission-critical capability. Certificate Lifecycle Management (CLM) is often seen as the answer, but CLM at enterprise scale is more complex than most anticipate. This panel brings together thought leaders from various CLM vendors and industry experts to unpack the strategic lessons learned and operational friction points that organizations face in aligning CLM systems with quantum-resilient architectures.
            speakers:
              - Chris Bailey
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

          - title: "Turning Quantum Threats into Opportunities: Modernizing WebPKI with QUIC and Metrics-Driven Insights"
            description: |
              "As the web accelerates toward Post-Quantum Cryptography (PQC), many discussions focus on key exchange and signature upgrades in TLS. This session takes a metrics-driven technical lens to argue and accelerate PQC migration and a catalyst for a necessary transformation of the WebPKI HTTPS/TLS stack with QUIC.
              We will present a comprehensive analysis of the performance, latency, and security implications of PQC along with recent and upcoming changes to WebPKI in the context of QUIC and HTTP/3, including:
              Latency Benchmarks: Comparing TLS 1.3 over TCP vs QUIC,  0-RTT and session resumption and security posture shifts.
              Early results from hybrid PQC handshakes (e.g., X25519 + Kyber) over QUIC, with handshake size, CPU & memory footprint,Impact of short-lived certificates and ACME automation on revocation, incident response, and operational risk.
              Protocol Layer Efficiency: Analysis of QUIC, multi-stream behavior, and WebPKI’s role in seamless multi-origin TLS"
            track: 
            speakers:
              - Muralidharan Palanisamy
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "15:00"
        sessions:
          - title: "PQC in Action: From Global Standards to Secure Deployments"
            description: |
              This session delivers the latest insights into Post Quantum Cryptography (PQC), beginning with an update on current standards, regulatory developments, and emerging technologies. It continues by connecting these advancements to real-world customer projects, illustrating how PQC is being applied across industries. As PQC moves from theory to deployment, attendees will explore how organizations are securing digital communications, implementing hybrid encryption, and enabling secure firmware updates. The session offers practical knowledge and implementation strategies — providing a clear view of the current state of PQC standardization, industry adoption, and the technical challenges of real-world integration.
            speakers:
              - Nils Gerhardt
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
          - title: "Get Fit For The Qubit: The Dutch approach to a Quantum Secure Society"
            description: |
              This presentation gives a thorough overview of the Dutch Roadmap and Ambitions concerning a Quantum Safe Society. This roadmap has been established in 2023, but went through various changes as the attention towards the subject of Quantum Computing grew. Besides the involvement of the central government, also knowledge institutions helped in developing the roadmap. The presentation will cover how the roadmap came to be, the various challenges it met along the way and how those challenges were met. The presentation will also include a forecast towards 2026 and beyond, on what the Dutch Government aims to achieve on the national level, not only on the Governmental level, but also for Vital Industries. And how will the European Commissions’ Coordinated Implementation Roadmap for the Transition to Post-Quantum Cryptography Influence the current Dutch efforts? I’ll address all this during this presentation! 
            track: 
            speakers:
              - Pieter Schneider
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
          - title: Navigating the Quantum Era – A Strategic Path to Resilience
            description: |
              This panel discussion isn't just about understanding the quantum threat; it's about charting a clear, actionable course for enterprises to achieve resilience in the quantum era. We'll dissect the impending quantum threat and explore the critical migration strategy to secure enterprises for the quantum era, today and tomorrow.
              The panel will commence by contrasting the divergent national and regional strategies being pursued globally. From the collaborative, coordinated model of the European Union to more sovereign, state-driven approaches, the panel will highlight the nuances of each. This deep dive will also dissect the global landscape of Post-Quantum Cryptography (PQC) migration specifically relevant to the EU and Asia Pacific regions. We'll contrast these national strategies – focusing on Collaborative, Sovereign, and Capacity-building efforts – against the NIST standardization baseline, a crucial benchmark for the industry.
              The core objective of this panel is to synthesize these divergent paths into a clear, actionable framework for business and technical leaders. We'll move beyond the theoretical to deliberate a practical strategy that transforms PQC migration from a complex technical challenge into a strategic imperative for risk mitigation, operational resilience, and securing a sustainable competitive advantage in the quantum era.
            speakers:
              - Lim Huck Hai *
              - Albert de Ruiter
              - William Gee
            youtube:
            presentation: 
            locations:
              - plenary

          - title: HSM Advances Supporting quantum-safe PKI Automation
            description: |
              New advances in Hardware Security Modules (HSMs) are enabling automation opportunities during certificate issuance. One such advance is the progress on hardware-supported attestation where a CA can ascertain the location and disposition associated with the subject key. This supports enforcing policies such as the ones relating to code signing where subject keys must be generated and held by specialized hardware. The concepts surrounding attestation have been developing quickly within the IETF (RATS working group) and work is underway to bridge the gap to HSMs. Attestation functions within the HSM enable other features such as secure audit, verification of the state of an HSM, origin of keys, and more. It is imperative that this attestation capability be quantum-safe if it is to be relied upon for key management of other quantum-safe assets. Furthermore, as attestation relies on hardware roots of trust, this capability must either be deployed at manufacturing time or with the use of quantum-safe mechanisms. This presentation describes a quantum-safe attestation feature, how it can be employed within a PKI environment, and how it can be securely deployed. It also shows the advances in automation and the improvement in compliance that arises from adopting these techniques.
            speakers:
              - Olivier Couillard
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

          - title: Transitioning to Post-Quantum Cryptography in IAM
            description: |
              The quantum threat demands urgent upgrades to IAM systems, spanning TLS, PKI (encryption and digital signatures), and SSO protocols like SAML and OIDC. This session outlines practical strategies for transitioning to post-quantum cryptography, emphasizing post-quantum TLS (e.g., ML-KEM) and quantum-safe PKI. We highlight hybrid encryption and hybrid digital signatures to enable smooth migration with backward compatibility. Additionally, we provide actionable post-quantum recommendations for organizations to ensure crypto agility and resilience in identity management.
            speakers:
              - Udara Pathum
            youtube:
            presentation: 
            locations:
              - breakout"

      - time: "10:00"
        sessions:
          - title: "Cryptographic Discovery and Inventory: The Hidden Foundation for Enterprise Security"
            description: |
              Most enterprises are preparing for tighter regulations, certificate renewal challenges, and post-quantum threats — yet few have a complete picture of their cryptographic landscape. Without visibility, automation and resilience remain out of reach.

              This session will reveal how organizations can build a robust cryptographic inventory and discovery process, comparing three leading approaches: targeted scanning of cryptographic material, leveraging existing databases, and full enterprise assessments. We’ll map these strategies to US-NIST and CISA use cases, explore their advantages and limitations, and show how they form the foundation for PKI automation and post-quantum readiness.

              Attendees will leave with actionable steps to uncover, document, and manage cryptographic assets, tackle the 47‑day certificate renewal challenge, and build a scalable, future-ready security posture.
            speakers:
              - Dr. Alexander Loew
            youtube:
            presentation: 
            locations:
              - plenary

          - title: "PQC Formal VErification: Challenges and Tools for Formal Verification of Post-Quantum Cryptography"
            description: |
              As post-quantum cryptography advances toward deployment, formal verification becomes essential for ensuring trust in both hardware and software implementations. Each PQC algorithm—such as ML-KEM, ML-DSA, and SLH-DSA—presents unique challenges, and while tools like Cryptol, SAW, and Coq offer valuable support, no single framework offers a complete solution. In this talk, we introduce an effort focused on practical formal assurance for PQC. We will demonstrate how Cryptol and SAW can verify key properties of ML-KEM and ML-DSA components. We also highlight the growing role of Rust in cryptographic implementations and discuss the importance of verifying PQC libraries in memory-safe languages. Our goal is to promote scalable, implementation-aware formal methods to ensure secure and verifiable PQC adoption.
            speakers:
              - Reza Azarderakhsh
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

          - title: Hybrid Quantum-Safe Cryptography for Electric Vehicle Charging Infrastructure
            description: |
              Europe is advancing in EV adoption to combat climate change and support renewable energy. This shift requires redesigning the energy infrastructure for charging demands. The DITM project aims to create a digital infrastructure for automated transport, enhancing safety, efficiency, and sustainability. The EnergyPod, part of DITM, optimizes EV charging and manages grid interaction. To secure against future quantum threats, TNO, NXP, and Infiniot upgraded OCPP with hybrid quantum-safe cryptography (TLS handshake and X.509 certificates). This protocol was tested on the NXP “i.MX 8” board, similar to those in real charging stations, and will be used in the EnergyPod. Various migration scenarios were tested, and a dashboard was developed to monitor real-time quantum-safe communication. In this talk, I will discuss the setup, process, challenges, and key takeaways from migrating a high-level protocol to hybrid PQC.
            track: 
            speakers:
              - Alessandro Amadori
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

          - title: "NQSN Singapore: Quantum-Safe Network Testbed with Versatile Reference Applications"
            description: |
              We present the strategic vision and technical foundations of Singapore’s National Quantum-Safe Network (NQSN)—a resilient, fully interoperable quantum-safe testbed. Built on production-grade fiber infrastructure in a star-topology layout, the network supports multi-protocol quantum key distribution (QKD) from multiple vendors. A centralized key and network management system ensures interoperability and enables seamless integration across heterogeneous quantum and classical technologies. The testbed also supports diverse reference applications, including data center interconnects, edge computing, hybrid QKD–post-quantum cryptography (PQC) encryption, and multi-layer security across the OSI stack. These efforts demonstrate the feasibility, adaptability, and real-world relevance of deploying quantum-safe technologies in complex network environments.
            speakers:
              - Jing Yan Haw
              - Hao Qin
            youtube:
            presentation:  
            locations:
              - breakout

      - time: "12:00"
        sessions:
          - title: "From Inventory to Action: Navigating the Next Phase of PQC Transition"
            description: |
              Over the past few years, cybersecurity professionals worldwide have been urged—by security agencies and consultants alike—to kickstart their post-quantum cryptographic transition with a cryptographic inventory. Many have taken that advice to heart, amassing vast amounts of cryptographic data. Now, organizations face the critical question: how do we turn this information into action? 
              This presentation explores that very question. We’ll examine the next critical steps in the PQC transition from multiple perspectives—technical, strategic, and operational—and offer actionable guidance including prioritizing frameworks, risk-based approaches, and implementation timelines to help organizations turn insight into meaningful progress.
            speakers:
              - Bruno Couillard
            youtube:
            presentation: 
            locations:
              - plenary

          - title: "Beyond the Quantum Threat: Demonstrating Real-World Blockchain Resilience"
            description: |
              Cryptocurrencies rely on PKI to ensure the authenticity and integrity of transactions through digital signatures. At the heart of this trust model is Public Key Infrastructure (PKI), which underpins the authenticity and integrity of every transaction within a blockchain network. PKI ensures that digital signatures—whether from payers initiating cryptocurrency transfers or validators confirming blocks—are verifiable and tamper-proof. RSA and ECC have long secured this ecosystem, but quantum computing threatens to break these algorithms via Shor’s algorithm, enabling private key recovery. An existing cryptocurrency network has been successfully transitioned to quantum-safety by using NIST finalist post-quantum algorithms, preserving performance, interoperability, and trust. This work demonstrates not only the feasibility but also the urgency of adapting PKI for a secure, post-quantum blockchain future.
            speakers:
              - Andrew Cheung
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "12:30"
        sessions:
          - title: How ETSI Is Preparing for PQC
            description: |
              Settling on PQC algorithms is only part of the journey to make our digital systems safe from the Quantum Apocalypse.  An essential step is for certificates of various types to support PQC and for the regulations to allow them. 
              
              ETSI is the governing body empowered by the European Union to give us the eIDAS standard for digital certificates.  In this session you will learn ETSI’s plans for PQC, the status PQC in the standards-making process, and expectations for when PQC-enabled eIDAS certificates will be available. 
            speakers:
              - Inigo Barreira
            youtube:
            presentation: 
            locations:
              - plenary

          - title: Post Quantum Key Exchange in VPN Using ML-KEM-768
            description: |
              This paper presents a user-space integration of ML-KEM-768, a post-quantum key encapsulation mechanism standardized by NIST, with WireGuard, a modern VPN protocol. Rather than modifying the kernel-level X25519 elliptic-curve Diffie-Hellman handshake, the proposed approach establishes a Kyber-based shared secret over sockets and injects it as a pre-shared key (PSK) into WireGuard’s Noise protocol. This en-hances WireGuard’s resistance to quantum attacks without altering its core code. Experimental results demonstrate successful key agreement and acceptable performance overhead, making the solution viable for hybrid VPN deployments in the post-quantum era
            speakers:
              - Anurag Krishna Sharma
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
          - title: "PQC in Practice: Why This, Not That?"
            description: |
              As the industry accelerates preparations for the post-quantum era, a growing number of organizations are grappling with a practical question: Which PQC deployment strategy is right for us? Should we adopt hybrid certificates, go pure post-quantum, use composite keys, or run dual cryptographic infrastructures? Each approach offers different trade-offs in terms of risk, interoperability, compliance, and operational complexity.
      
              This panel brings together leading experts and implementers to explore real-world use cases, deployment decisions, and the rationale behind them. Panelists will share insights into how organizations are evaluating the threat landscape, aligning cryptographic agility with business needs, and choosing between strategies.
      
              This session is designed for architects, security engineers, and decision-makers who need to answer the increasingly common question: What should we do, and why?
            track: 
            speakers:
              - Sven Rajala *
              - Sudha Iyer
              - Corey Bonnell
              - Tadahiko Ito
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
          - title: "Crypto-Agile PKI: A Strategic Blueprint for Post-Quantum Trust"
            description: |
              "Quantum computing is reshaping the foundations of digital trust, and PKI must be the first to adapt. While NIST-standard algorithms like ML-KEM and ML-DSA progress toward adoption, organizations face a deeper challenge: evolving legacy PKI into a crypto-agile, automated, and future-ready infrastructure. This session presents a concise 20-minute blueprint for enabling that transition, without starting from scratch.
      
              We’ll explore three strategic priorities:
              1) Assess cryptographic exposure across TLS, S/MIME, code signing, and device identity.
              2) Embed crypto-agility and automation into certificate lifecycles using hybrid certs (draft-ietf-lamps-x509-slhdsa-09), short-lived certificates, and ACME-based issuance models.
              3) Align PKI governance with emerging standards from NIST(1800-38B), ETSI, CAB Forum, and IETF."
            track: 
            speakers:
              - Ganesh Mallaya
            youtube:
            presentation: 
            locations:
              - plenary

          - title: Implementing Hybrid TLS with ML-KEM-768 for Post-Quantum Security in Mobile IIoT Deployments
            description: |
              This study integrates post-quantum cryptography into mobile IIoT via Cisco Packet Tracer models of Mobile Manufacturing Trucks and a centralized Security Operations Center. Trucks deploy sensors, routers and Quantum Shieldz AX200 modules and the SOC uses AX300DS and AXMS100DS. Hybrid TLS merges ECDHE with the ML-KEM-768 key-encapsulation mechanism (as standardized in NIST FIPS 203) . Node-RED and MQTT simulate real-time sensor streams over channels secured by SHA-3 integrity checks and QRNG keys. Tests show a 1.3× handshake-latency increase, under 300 ms responsiveness and anomaly detection under 1.5 s, meeting IEC 62443. Simulated MITM, DoS and outages yield seamless failover and state restoration. These findings confirm PQC feasibility in resource-constrained mobile IIoT and highlight the need for quantum-safe strategies. Future work will explore AI anomaly prediction, lattice signatures and hardware attestation.
            track: 
            speakers:
              - Danny Setyowati
            youtube:
            presentation: 
            locations:
              - breakout

      - time: "16:30"
        sessions:
          - title: "From Noise to Clarity: Adding Intelligence to the PQC Migration"
            description: |
              Cryptographic inventories in modern enterprises are vast and the resulting alert fatigue often obscures true risk. This talk presents a novel method for automated, context-aware triage of cryptographic vulnerabilities. The technique leverages a large-scale, expert-curated knowledge base of cryptographic objects to enrich an organization's asset inventory.
              
              This enrichment process automates expert-level analysis to distinguish benign issues (e.g., a weak key in sample code) from critical threats (the same key in production). By intelligently filtering informational noise & presenting assets in a structured, explorable format, the method transforms data overload into actionable intelligence. We demonstrate how this context-aware triaging enables security teams to isolate root causes & shift from reactive alert management to a strategy of precise, proactive remediation. The cryptographic clarity achieved through this method will significantly accelerate an organization's migration to PQC.
            speakers:
              - James Howe
            youtube:
            presentation: 
            locations:
              - plenary

          - title: Evaluating the Practical Capabilities of Contemporary Quantum Processors in Breaking AES Encryption
            description: |
              As quantum computing advances, assessing the potential of current architectures to threaten AES encryption is essential. This study evaluates leading quantum processors, IBM, Google, Zuchongzhi 2, Microsoft, Rigetti, IonQ, and Honeywell, focusing on quantum gate complexity, qubit coherence time, and scalability trade-offs. It demonstrates how these systems, when scaled to thousands of qubits with error correction, could compromise AES security. The findings offer clearer insight into the timeline of quantum threats, aiding in strategic planning for mitigation and PQC migration. Enhancing AES robustness through longer key sizes and hybrid models is also explored to strengthen cryptographic readiness.
            speakers:
              - Somrak Petchartee
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
