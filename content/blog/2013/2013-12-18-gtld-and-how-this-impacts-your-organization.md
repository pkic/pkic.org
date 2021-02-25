---
authors:
- Jeremy Rowley
date: "2013-12-18T17:00:18+00:00"
dsq_thread_id:
- 2058909581
keywords:
- policy
- casc
- revocation
- mitm
- mozilla
- pki
- ca/browser forum
- icann
- qualified
- ssl
- vulnerability
- announcement
tags:
- Policy
- CASC
- Revocation
- MITM
- Mozilla
- PKI
- CA/Browser Forum
- ICANN
- Qualified
- SSL/TLS
- Vulnerability
- Announcement
title: ICANN’s Accelerated gTLD Delegation Process and How This Impacts Your Organization


---
After the CASC’s [previous][1] letter addressing ICANN’s proposal to delegate nearly 2000 new gTLDs for use on the public Internet, ICANN identified and initiated an extensive study on two significant [security][2] [issues][3]. Now, based on the conclusions of the studies, ICANN is moving forward quickly with the delegation process, delegating more than [30][4] in the last two months alone. With ICANN ramping up the delegation process, nearly all 2000 will be delegated under the new rules, with only .corp and .home reserved as high risk gTLDs. This post serves as an advisory for interested network administrator on how the newest ICANN decisions may affect their networks and certificates.

### Background

For the better part of this year, members of the CA Security Council (CASC) have been actively working with like-minded parties to inform ICANN about primary concerns with accelerated delegation of new gTLDs. These discussions have focused on two primary areas: 1) the need for a careful analysis of the security impacts of such action, including identifying the most commonly used internal name extensions; 2) proper consideration of the impact that delegation will have on existing network architectures.

A security concern [related to certificates used on internal servers][2] was identified early on in the process. After discovering the risk for a MITM vulnerability created by ICANN’s delegation of new gTLDs, the CA/Browser Forum quickly acted to accelerate the deprecation of internal name certificates for delegated gTLDs. The CA/Browser Forum originally set a deprecation date of October 2016 based on server operator input about the time-frame and expense required to configure all systems to use fully-qualified and resolvable domain names. However, in the interest of ensuring security for all users, the CA/Browser adopted a rule requiring CAs to revoke any certificate containing a proposed new gTLD [within 120 days of ICANN approving the new gTLD][5]. This rule has since become part of the Mozilla root policy, making it a mandatory requirement for essentially all publicly trusted CAs.

After the CA/Browser Forum resolved the conflict between the new gTLDs and existing internal certificates, ICANN focused its efforts on [investigating the possibility of collisions between the new gTLDs and existing internal name networks][6]. After reviewing the data, ICANN established an [80/20 rule][7], which permitted 80% of the gTLDs to move forward with delegation. These domains were free from detected conflicts. The remaining 20% required further consideration. Two (.corp and .home) were identified as high risk.

### Accelerated Delegation for All gTLDs

In October 2013, ICANN’s decided to eliminate the 80/20 rule on the basis that registries can mitigate the impact of potential collisions using simple delegation rules. Here is a brief summary of some of the key points:

  * Of the proposed gTLDs, only .home and .corp will not be delegated and are permanently reserved for further consideration. ICANN will accelerate the gTLD delegation process, listing the delegated gTLDs [here][4]. 
  * To mitigate collision risks, registries will be [restricted from delegating second-level domains (SLDs)][8] if the SLD was detected pre-delegation. This SLD block varies depending on several factors and may be temporary depending on the origins of the potential collision, evidence that the potential for a collision became negligible, and other mitigating factors.
  * Anyone affected by delegation may report a collision to ICANN through a portal currently under design. 
  * ICANN will develop an outreach program to make private network operators aware of possible name collisions caused by the gTLD delegation, similar to the initiatives CASC has taken.

### What Does This Mean For Your Company?

With most of the new gTLDs moving forward, network administrators need to understand the ramifications of these delegations and take proactive measures to prepare their networks for what’s to come. Here are a few items to keep in mind:

  * Administrators should frequently analyze networks and make sure all systems are configured to use fully-qualified domain names. Many CASC members offer tools designed to help administrators detect and reconfigure systems still using internal names. 
  * Keep all internal networks secure and prevent them from being discoverable on the web. The Interisle report revealed that a surprising number of internal networks are actually publicly accessible. Not only is this a security risk, but the names used by these “leaky” servers are going to be restricted from registration, potentially impeding future registration of the domain name. This restriction may lead to difficulties in brand protection in newly delegated gTLDs and may make registering the domain impossible before the certificate revocation deadline.
  * Network administrators should use the ICANN portal to report potential collisions as soon as possible. The best way to avoid collisions is let ICANN know before the gTLD is delegated. 
  * Although the most common internal names are being permanently reserved, ICANN will soon delegate a few of the more controversial names, including .mail, .exchange, and .ads. Network operators should discuss their existing certificates with the issuing CA to ensure they are adequately prepared. Certificates will be revoked within 120 days of the ICANN-Registry contract publication date. The [ICANN listing][4] is not the list or date the CA must use to revoke the certificate. Working closely with CAs will ensure that all network administrators have the latest information and are aware of important dates. 
  * Regardless of delegation, CAs cannot issue SSL certificates containing an internal name if the certificate’s expiration date is later than October 2016. However, as of November 1, 2015, CAs will no longer be able to issue SSL certificates with an internal server name. Administrators should ensure they have sufficient time to move all resources to a FQDN or private PKI well-before the November 2015 date to facilitate a smooth transition.

We advise all network administrators to convert their internal networks and corresponding certificates to FQDNs as soon as possible. gTLD delegation is accelerating with dozens being released weekly. Please make sure you are prepared and ready for this change.

 [1]: https://casecurity.org/2013/03/22/what-the-icann-ssac-report-doesnt-tell-you/
 [2]: http://www.icann.org/en/groups/ssac/documents/sac-057-en.pdf
 [3]: http://www.icann.org/en/groups/ssac/documents/sac-062-en.pdf
 [4]: http://newgtlds.icann.org/en/program-status/delegated-strings
 [5]: https://cabforum.org/internal-names/
 [6]: https://www.icann.org/en/about/staff/security/ssr/name-collision-02aug13-en.pdf
 [7]: https://www.icann.org/en/about/staff/security/ssr/new-gtld-collision-mitigation-05aug13-en.pdf
 [8]: http://www.icann.org/en/news/announcements/announcement-03dec13-en.htm