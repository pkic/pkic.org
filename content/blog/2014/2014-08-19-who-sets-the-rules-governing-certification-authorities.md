---
title: Who Sets the Rules Governing Certification Authorities?
authors: [Kirk Hall]
date: 2014-08-19T15:30:46+00:00
dsq_thread_id:
  - 2940431346


---
Every time something positive is published about SSL and encryption,such as Google&rsquo;s recent decision making use of _https_ encryption a favorable rating factor for a website, or negative, such as the Heartbleed issue &ndash; bloggers and others always post questions about public Certification Authorities (CAs), including general questions on who sets the rules that govern CAs. Some bloggers seem to assume there are no rules or standards, and that CAs can operate without any requirements or limitations at all &mdash; that&rsquo;s incorrect.

The answer on who sets the rules governing CAs is two-fold: in the first and last instance the browsers and applications that enable the use of SSL digital certificates (such as Microsoft, Mozilla, Apple, Google, etc.) set the rules. In addition, the CAs and browsers jointly set additional rules through guidelines and requirements approved by the CA/Browser Forum, which effectively apply to all public CAs in the world.1

Here&rsquo;s how it works.

## Rules set by browsers and applications

Certificates issued by public CAs will only be recognized by browsers if the browsers have accepted the CA roots as &ldquo;trusted&rdquo; in the browser&rsquo;s root store. Some browsers don&rsquo;t maintain their own trusted root store but instead rely on the root store of the client&rsquo;s operating system &ndash; however, these browsers can still disable roots they choose not to trust. An end-entity certificate securing a website that was issued by a CA root that is _**not**_ included in the browser or operating system root store will generate a warning sign to a client that visits the secured web page. Here&rsquo;s an example:

{{< figure src="/uploads/2014/08/who-sets-the-rules.jpg" >}} 

This happens because the client&rsquo;s copy of the browser always checks the issuing root2 in the browser root store &ndash; if the issuing root is not there (or is there but marked as &ldquo;untrusted&rdquo;, as in the case of Diginotar&rsquo;s roots), clients are warned off. Consumers can look in their favored browser (if the browser maintains a trusted root store instead of relying on the client&rsquo;s operating system) to see which CA roots are included as trusted and can remove or add roots if they choose (to do this in Internet Explorer, for example, go to _Tools &ndash; Internet Options &ndash; Content &ndash; Certificates &ndash; Trusted Root Certification Authorities,_ for example.)

How does a browser decide whether or not to accept and trust a CA&rsquo;s roots in the browser&rsquo;s root store? The browsers have always had trusted root store rules (the do&rsquo;s and don&rsquo;t&rsquo;s on how CAs should operate), and starting in 2000 they also required CAs to submit a successful annual WebTrust for CAs or equivalent ETSI audit showing the CA satisfied certain disclosure, operational, and security requirements.

Over time, the browser root program rules have expanded significantly, eventually addressing various technical issues (e.g., gradually outlawing weaker algorithms such as MD5 and SHA-1, and weaker key sizes such as 512-bit and 1024-bit certificates for the minimum size 2048-bit keys today) as well as the nature of products that can be sold to customers (e.g., outlawing the issuance of unconstrained certificates that can be used by an enterprise customer at its firewall for corporate man-in-the-middle attacks on internet traffic of its employees). The trusted roots of CAs that fail to meet these requirements can be &ndash; and have been &ndash; removed from or marked as distrusted by the browser root store, which can effectively be a death sentence for the CA.

Browser root program requirements have expanded in some cases to go beyond simple certificate health and practices, and to impose complex new technology changes on how SSL certificates are issued and confirmed as valid &ndash; see, for example, Google&rsquo;s impending Certificate Transparency (CT) requirements for all CAs:

  * <http://www.chromium.org/Home/chromium-security/certificate-transparency>
  * <https://a77db9aa-a-7b23c8ea-s-sites.googlegroups.com/a/chromium.org/dev/Home/chromium-security/root-ca-policy/EVCTPlan19Mar2014.pdf>

The current version of the most influential browser root program rules can be found at these links:

  * Microsoft: <http://social.technet.microsoft.com/wiki/contents/articles/3281.introduction-to-the-microsoft-root-certificate-program.aspx>
  * Mozilla: <https://www.mozilla.org/en-US/about/governance/policies/security-group/certs/policy/>
  * Google: <http://www.chromium.org/Home/chromium-security/root-ca-policy>
  * Apple: <http://www.apple.com/certificateauthority/ca_program.html>
  * Oracle/Java: <http://www.oracle.com/technetwork/java/javase/javasecarootcertsprogram-1876540.html>

As this list demonstrates, CAs must meet a long list of strict browser requirements to stay in compliance with all these root program rules.

## Rules adopted jointly by CAs and browsers

The second source of the rules that CAs must follow have been developed and approved by the CAs themselves (with the concurrent approval of the browsers as well) through the CA/Browser Forum (Forum), which meets in bi-weekly telephone conference calls and face to face meetings three times a year.

The Forum is a voluntary group open to all CAs worldwide that issue publicly trusted SSL certificates and all browsers and applications that produce a software product intended for use by the general public for browsing the Web securely. See <https://cabforum.org/information-for-potential-members/>. Currently there are 42 CA members and 5 browser members of the Forum.

The Forum has produced and updated two major sets of guidelines binding on all CAs:

  * **Extended Validation (EV) Guidelines** &ndash; Technically the &ldquo;Guidelines for the Issuance and Management of Extended Validation Certificates,&rdquo; now in version 1.5. The EV Guidelines were first adopted in June 2007, and govern technical, security, and authentication requirements for any CA that wants to issue EV certificates that will be given the coveted &ldquo;green bar&rdquo; in the browser.
  * **Baseline Requirements (BRs)** &ndash; Technically the &ldquo;Baseline Requirements for the Issuance and Management of Publicly-Trusted Certificates,&rdquo; now in version 1.1.9. The BRs apply to all publicly-trusted certificates, including Domain Validated (DV), Organization Validated (OV), and EV certificates (in addition to the requirements of the EV Guidelines).

The latest copies of these documents can be found here: <https://cabforum.org/documents/>

The Forum is always working on potential revisions and improvements to these guidelines, including the recent Network and Certificate System Security guidelines to be added to the Baseline Requirements. The Forum also sponsors ongoing committees and public Working Groups such as those focused on Code Signing Certificates, EV Guidelines revisions, and SSL Performance. For additional information, see: <https://cabforum.org/current-work/>

## Enforcement of the CA/Browser Forum Guidelines

For obvious reasons, no CA can impose rules on any other CA &ndash; so how is compliance by every CA with the EV Guidelines and Baseline Requirements actually enforced? This brings us back to the browsers again.

As each set of guidelines and updates is adopted, they are submitted to a Canadian Institute of Chartered Accountants/American Instititue of CPAs working committee to be converted to new or updated WebTrust audit guidelines. Similar audit guidelines are drafted by the European Telecommunications Standards Institute (ETSI), which is an alternative audit regime accepted by the browsers. The current WebTrust audit guidelines can be found here: <http://www.webtrust.org/homepage-documents/item27839.aspx>. For current ETSI audit standards, see: <http://portal.etsi.org/TBSiteMap/ESI/TrustServiceProviders.aspx>. 

Once new audit guidelines are ready, the browsers then close the loop by adding a new requirement to their trusted root store program rules that all CAs complete successful annual WebTrust/ETSI audits that follow the _new_ or _updated_ audit guidelines (which include all new Forum recommendations), starting as of a stated effective date. For example, the Forum&rsquo;s Baseline Requirements were made effective as of July 1, 2012, were then incorporated into updated WebTrust BR audit standards by that fall, and were subsequently added as a mandatory requirement of Mozilla&rsquo;s trusted root program as of February 2013.

There are a number of government-run CAs around the world (some of which issue identity certificates to their citizens and businesses), and they have typically not been willing to submit to a WebTrust or ETSI audit. Instead, they prefer to follow their own internal audit regimes conducted by other government agencies that they assert are the equivalent to WebTrust/ETSI audits. However, it appear these government audit regimes aren&rsquo;t as rigorous or comprehensive as WebTrust/ETSI. For example, in many jurisdictions a government audit happens only every two to threee years, as opposed to annually for WebTrust/ETSI, and the resulting audit report typically contains few details. Unfortunately, the browser root programs have chosen to accept these government audit reports. The government-related India CCA reported a significant breach in July 2014, but relatively little information about the cause or nature of the breach is available. See: <http://googleonlinesecurity.blogspot.com/2014/07/maintaining-digital-certificate-security.html>

A good step toward making SSL certificates more secure worldwide would be for the browsers to require government CAs to submit to annual WebTrust or ETSI audits as other public CAs with trusted roots do, instead of internal government audits.

## Rules governing SSL implementation by the browsers

Finally what rules govern SSL implementation by _browsers_ and _applications_? As a practical matter, none except for general X.509 standards. While browsers must follow these same general technical standards stated in applicable RFCs to make SSL work, they are otherwise free to set their own rules for how their browsers implement and confirm the validity of certificates. Browsers are jealous of their prerogatives in a highly competitive market, and sometimes are not willing to abide by recommendations set by industry consensus. 

For example, some browsers have cut back on revocation checking (typically done by checking with the issuing CA via CRLs or OCSP responses to see if a particular certificate being viewed by a client has been revoked or is still good) in order to maximize browser response and minimize latency. The browsers make their own decisions on which of these implementation issues to deal with, and CAs can do little more than make suggestions for improvement and hope for the best.

## Summary

In summary, the rules governing CAs are many and complex, including the complex requirements of browser root programs, the CA/Browser Forum guidelines and requirements, and the three WebTrust/ETSI audit regimes that must be satified each year. But in the end it&rsquo;s the browsers that enforce compliance by CAs in order for each CA&rsquo;s roots to remain in the trusted root store and for its end-entity certificates to be treated as trusted.

CAs have contributed mightily to improving SSL certificate standards over the past decade, and most CAs are enthusiastic supporters of higher security requirements. Working together, the CAs, browsers, and other members of the internet community have consistently raised the bar in recent years, and have responded to new threats and issues as they arise to keep SSL and digital certificates as an essential part of a secure web.

1 There are also basic technical standards that apply to SSL implementation itself, such as the IETF&rsquo;s RFC 5280 on X.509 Public Key Infrastructure &ndash; this article does not cover those technical standards.

2 Although we refer to &lsquo;issuing roots&rsquo;, root certificates issue intermediate or &lsquo;issuing&rsquo; CA certificates which in turn issue end entity certificates. This indirection has been omitted for readability and simplicity through the rest of this document.