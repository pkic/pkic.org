---
title: CASC Heartbleed Response
authors: [CA Security Council]
date: 2014-05-08T15:45:14+00:00
dsq_thread_id:
  - 2670224904


---
The recent Heartbleed issue has reawakened interest in SSL certificate revocation (see Adam Langley&rsquo;s [blog][1], Larry Seltzer&rsquo;s articles [here][2] and [here][3], and Steve Gibson&rsquo;s [web pages][4])

Several years ago, the CA Browser Forum convened a special Revocation Working Group to explore issues and solutions. Leading CAs were actively involved in that group, and many of them invested in moving their OCSP responders to high-performance, high-availability Content Delivery Networks (CDNs) to respond to browser vendors&rsquo; requests for increased performance and reliability. 

Google was part of the Revocation Working Group and announced CRLSets to that group and the wider CA Browser Forum. CAs were disappointed that Chrome wouldn&rsquo;t actively retrieve OCSP responses from them, but we were under the impression that CRLSets would include most revoked certificates. Adam did ask CAs to help CRLSets by telling Google about important revocations, and CAs largely complied, for example, when the CA had to revoke intermediate certificates. But CAs have no reliable way of knowing which end-entity certificate revocations are important, since certificate owners don&rsquo;t reliably tell CAs whether or not the revocation is important. Many CAs allow the customer to choose from a list of &ldquo;revocation reasons&rdquo;, but just as companies are hesitant to reveal that they&rsquo;ve suffered a security breach, it&rsquo;s assumed that they are hesitant to tell the CA that their private key had been compromised (this would constitute an important revocation). 

As a result, end users and browsers have no way to determine whether a certificate was revoked because of the server&rsquo;s loss of control over the key, fraudulent activity by the server administrator, the presence of malware on site, or simply out of an abundance of caution. Heartbleed is a perfect example of why revocation is important even without identified key compromise. No one can say for certain that their server&rsquo;s private key was compromised. Most of the revocations that have occurred are going on CRLs for &ldquo;business reasons&rdquo; (as Adam defines it) and not picked up by CRLSets. 

It&rsquo;s now clear that CRLSets are simply a blacklist of high-profile revoked certificates. Other browsers have similar blacklists, and these can be effective at times (for example, to indicate revocation of an intermediate certificate that may be several years old and does not contain an OCSP pointer). But they&rsquo;re not a substitute for OCSP checking of end-entity certificates.

Google moved away from supporting OCSP without adequately informing Chrome users of this fact. Although IE and Safari also soft-fail if an OCSP response is not received, those browsers still use OCSP by default. The engineers creating those browsers apparently have not concluded that OCSP is broken. Even if revocation checking by OCSP isn&rsquo;t 100 percent accurate, it can still protect a high percentage of users who navigate to a site with a revoked certificate and receive an OCSP response indicating revocation. Turning off revocation checking for everyone means that no one is protected.

All browsers compete on speed and performance, and OCSP checking can slow page loading. We think many browser users would tradeoff a small performance hit for increased confidence in the authenticity of the web site.

Revocation is a very complex issue, with lots of room for debate. Reasonable people can disagree on the effectiveness of using OCSP. The CASC agrees that OCSP Stapling, and putting OCSP Must-Staple extensions in certificates, is one of the best solutions to address many issues with revocation at this time. But until that happens, we oppose browsers removing (non-stapled) OCSP checks.

 [1]: https://www.imperialviolet.org/
 [2]: http://www.zdnet.com/chrome-does-certificate-revocation-better-7000028589/
 [3]: http://www.zdnet.com/certificate-revocation-controversy-heats-up-7000028920/
 [4]: https://www.grc.com/revocation.htm