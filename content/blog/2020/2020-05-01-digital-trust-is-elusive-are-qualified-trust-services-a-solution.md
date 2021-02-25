---
authors:
- Sebastian Schulz
date: "2020-05-01T17:00:58+00:00"
keywords:
- etsi
- tls
- enisa
- trust service providers
- eidas
- qualified trust service providers
- qualified
- ssl
- trust list
- phishing
- attack
- european union agency for cybersecurity
- policy
tags:
- ETSI
- SSL/TLS
- ENISA
- TSP
- eIDAS
- QTSP
- Qualified
- Trust List
- Phishing
- Attack
- Policy
title: Digital Trust Is Elusive – Are Qualified Trust Services A Solution?


---
A popular saying goes: “Trust takes years to build, seconds to break, and forever to repair.”

While I wouldn’t completely agree, the idea isn’t wrong. In real life trust between two parties is established over some period of time, depending on a variety of factors. Have you ever wondered why you initially trust some people more and others less, even if you’ve never met them before? There are a complicated multitude of factors that influence our thoughts: the person’s appearance, tone of voice, title or rank, etc. Trust is established over time but can be lost within a few moments.

This poses a problem in the digital world, though. The factors we rely on for deciding whether to trust someone or something are completely different from the real world. We cannot judge by appearance if we do not see the other person, we cannot judge by tone of voice if we do not hear them, and titles and ranks are deceiving enough in the real world already. Online, we are often forced to decide whether to trust some other party within split seconds. This stands in contrast to real life, where one can take the time to verify whether the other party can really be trusted. The lack of information on which we normally base our trust, as well as the pressure to make a quick decision, leads to frequent errors in judgement. Those errors can be substantial – and costly. For example, you may fall victim to a phishing attack or another form of fraud, something that has emerged in recent years as a very critical issue online.

{{< figure src="/uploads/2020/04/digital-trust-1.png" title="Figure 1: From the 2019 Proofpoint report “State of Phish.” While we have come a long way in learning to be cautious online, phishing remains an ever-growing problem." >}}

## Introducing eIDAS  

The gravity of the trust issue didn’t elude policy makers and economists. In a [2011 study][1], the European Union found a lack of trust between merchant and purchaser to be one of the key factors inhibiting the success of eCommerce. Many steps were taken to overcome this issue, including the establishment of a unit called “eGovernment and Trust” and the subsequent launch of the regulation for Electronic Identification, Authentication, and Trust Services. eIDAS took effect in July of 2016, so you could say it’s been around for a while. Did it really help in resolving the issues with digital trust?

Before we get further into analyzing the adoption of eIDAS I have say that I haven’t forgotten about the large parts of the world where eIDAS isn’t applicable. There have been many other trust guidelines established across the globe, applicable to specific industries and countries. One example is the establishment of the [CA/Browser Forum][2] for public CAs which governs the issuance of publicly trusted SSL/TLS certificates. Another example for regulation, but only applicable to a certain country rather than a global industry, would be the Japanese Certification Authority Network (JCAN), maintaining a list of reliable trust services in Japan. We will later see how the adoption of eIDAS caused ripples in the global network of trust schemes, but first let’s turn to the initial adoption of eIDAS.

## What Have We Learned About Trust Since eIDAS?

A report from late 2017, published by the European Union Agency for Cybersecurity (ENISA), details how eIDAS was adopted since its creation in 2016. After only one year with Qualified Trust Services, did it become easier to verify trust online? The answer: It’s hard to say. Sure, 64% of Trust Service Providers (TSPs) came forward and said they planned on becoming Qualified Trust Service Providers (QTSPs). 90% of SMEs and Enterprises also saw eIDAS as an opportunity to grow their business. But the report also identified some barriers, especially the lack of understanding from citizens and businesses about what trust services are. Another issue was the lack of standardization and a lack of exact technical and legal specifications around trust services. Combined with many countries still maintaining different trust schemes on a national level, things get confusing.

On the bright side, eIDAS has proven to be a significant step forward in many areas. eIDAS was primarily meant to bring legal certainty wherever digital transformation would shake things up considerably. Making sure that there’s a standard for electronic signatures that would deliver the same level of confidence as wet ink signatures is the outstanding example but there are plenty of others. Another example could be the authentication with qualified certificates which allows citizens to access government services that otherwise would require them to apply in person, at a physical office. eIDAS also serves as the foundation to other regulations that aim to introduce more flexibility to a variety of processes, while not taking away from the security.

{{< figure src="/uploads/2020/04/digital-trust-2.png" title="Figure 2: Popularity of different trust services 1 year after the eIDAS rollout. Unsurprisingly, qualified signatures, seals and timestamps are most popular as they are easily implemented in digital transformation processes.">}}

A [recent report by ETSI][3] compared eIDAS to other trust schemes around the world. Some of the conclusions:

- While eIDAS does offer some good pointers regarding best practice, supervision, and auditing, it should be reviewed and tweaked with the upcoming 2020 revision.
- eIDAS needs more promotion but also needs to respect other, already existing trust guidelines and closely look at where they may offer solutions to some issues that remain unresolved by eIDAS.
- ETSI standards based on eIDAS may serve internationally as a template for the technical implementation of electronic signatures with a high level of assurance. Once international trust schemes have adapted to those technical standards, they could be added through the EU trust list by bridge certificates or similar means.

So eIDAS hasn’t solved the issue of digital trust quite yet but it is certainly making many processes faster, more comfortable, and more accessible. And that’s a good thing, right? For each and every one of us: The accountant, who can process his invoices much faster. The elderly lady, who can apply for her new passport online. And the enthusiastic young business owner who can now start a business in Germany while working remotely from the US.

 [1]: https://ec.europa.eu/newsroom/dae/document.cfm?doc_id=1815
 [2]: https://www.globalsign.com/en/blog/what-is-the-ca-browser-forum/
 [3]: https://www.etsi.org/deliver/etsi_tr/103600_103699/103684/01.01.01_60/tr_103684v010101p.pdf