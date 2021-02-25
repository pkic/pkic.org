---
authors:
- CA Security Council
date: "2013-06-05T02:23:43+00:00"
dsq_thread_id:
- 2096655623
keywords:
- casc
- ietf
- ca/browser forum
- ssl
- https
- mis-issued
- google
- microsoft
- attack
- certificate authority security council
- policy
tags:
- CASC
- IETF
- CA/Browser Forum
- SSL/TLS
- Mis-issued
- Google
- Microsoft
- Attack
- Policy
title: Some Comments on Web Security


---
Steve Johnson of the Mercury News posted an article on [Web security](http://www.mercurynews.com/business/ci_23271677/web-security-inside-secret-symantec-building-that-keeps) and highlighted some of the issues.

The posted issues help to explain why we created the Certificate Authority Security Council. We want to determine the issues, have them addressed and provide awareness and education on the solutions. The CAs also work with the browsers and other experts in the industry to develop standards for all CAs to be audited against through the CA/Browser Forum.

Here are some comments on the issues posted in the article.

**Attacking CAs to issue fake certificates** — The industry is working on solutions to prevent mis-issued certificates. For instance, the [CA/Browser Forum](https://www.cabforum.org/documents.html) has prepared a document for Network and Certificate System Security Requirements. This provides CAs with a standard for their CA system to meet.

**DigiNotar attack** — This attack was caught by a solution called public key pinning. Chrome has been programed so that all of Google’s certificates must be trusted by a few root certificates. When a Google certificate is issued from a certificate trusted by a non-pinned root certificate, then an error dialog will be displayed.  This was also used to discover the [TURKTRUST](http://turktrust.com.tr/en/kamuoyu-aciklamasi-en.html) mis-issued certificates. [Public Key Pinning](https://tools.ietf.org/html/draft-ietf-websec-key-pinning) will be documented in an IETF standard and then may be deployed for many domains.

**Standards haven’t been universally adopted** — Standards are prescribed by the company that embeds the root certificates into their software. Organizations such as [Microsoft](https://social.technet.microsoft.com/wiki/contents/articles/3281.introduction-to-the-microsoft-root-certificate-program.aspx) and [Mozilla](https://www.mozilla.org/projects/security/certs/policy/) have public policies which flow down standards. The CA/Browser Forum has developed standards for all SSL certificates (Baseline Requirements), EV certificates (both SSL and Code-signing) and System Security Requirements. Mozilla has required the CAs to adopt the Baseline Requirements and all browsers that support EV require the EV guidelines. We expect that the Baseline Requirements will be added into Microsoft and other software vendor policies in the future.

**CA attack disclosure** — Ever since the attack of DigiNotar, the CA industry has been very forthright in disclosing the knowledge of an attack which will impact certificate subscribers and end browser users. [GlobalSign](https://www.globalsign.com/company/press/090611-security-response.html) and [Startcom](http://www.h-online.com/security/news/item/Attack-on-Israeli-Certificate-Authority-1264008.html) made disclosures even though their attacks were successfully mitigated.

**Certified sites might not be safe** — Security analysts have found that certificate subscribers may ask for certificates with keys which are easily compromised. They also may deploy SSL in an insecure way. Such organizations as TIM, Qualys, and CASC are making information available, so subscribers will deploy their SSL solution properly. CAs have also put solutions in place to detect and reject keys which are easily compromised.

**Browsers may not display revoked certificates** — This is a challenge which we hope the browser manufacturers will acknowledge and resolve. Please note that the CAs are obligated to provide status of issued certificates. Browser users can either choose or configure most browsers to display a dialogue when a certificate has been revoked.