---
title: New Directions for Elliptic Curve Cryptography in Internet Protocols
authors: [Rick Andrews]
date: 2015-06-24T18:15:52+00:00
dsq_thread_id:
  - 3875121772


---
Last week I attended and presented at the National Institute of Standards and Technology (NIST) [Workshop on Elliptic Curve Cryptography Standards][1]. In NIST’s words, “The workshop is to provide a venue to engage the crypto community, including academia, industry, and government users to discuss possible approaches to promote the adoption of secure, interoperable and efficient elliptic curve mechanisms.”

We began by discussing the reasons for holding this workshop.  Speakers acknowledged that although there are no known issues with the current set of NIST curves, in some circles they are widely distrusted. In addition, they are almost 15 years old, not particularly resistant to side-channel attacks, and don’t perform as well as newer curves. For these reasons, many people feel that NIST should standardize on one or more new curves.

Researchers presented a number of methods for generating curves. Some have drawn from the digits of _pi_ or _e_ to generate parameters (since the NSA can’t manipulate these digits), and then insured that the resulting curves satisfied certain requirements. Others proposed using random processes (one involving hashing all tweets with a certain hashtag within a known time period) to derive parameters. The proponents argued that these would be safer than those chosen by a third party (NIST or the Internet Engineering Task Force, also known as IETF).

There was a good deal of debate about whether new fixed curves were needed, or whether NIST should recommend a family of curves from which developers could choose. My sense was that folks in the room preferred the former. There were already too many curves to choose from, they argued, some of which have never really been used. But the presence of multiple curves carries an on-going QA burden that is costly.

[I spoke][2] about support for Elliptic Curve Digital Signature Algorithm (ECDSA) in the Web today, and noted that six CAs that account for 67% of all SSL certs (RSA and ECDSA) offer ECDSA certs. I reported that Netcraft and another independent group saw that of all public-facing SSL certificates, 2% used ECDSA. And a large chunk of that number is attributed to CloudFlare’s Universal SSL initiative in which they proactively rolled out ECDSA certificates to their CDN customers.

Then I gave my opinion on why support for ECDSA had lagged: suspicion of the NIST curves, lack of support in Windows XP, partial support in IIS, lack of awareness of Elliptic Curve Cryptography (ECC), aversion to risk because RSA isn’t broken, and concern over Intellectual Property (patents).

In the session on ECC in Industry, panelists agreed that in choosing new curves, performance was not as important as trust and security. They didn’t mean that performance didn’t matter, but that in general ECC outperforms RSA for equivalent security strengths. And it was assumed that any new curves would also carry a similar advantage over RSA in performance.

Speakers discussed a number of criteria for choosing new curves (if NIST decided to pursue that route), including performance, provable trust, resistance to side-channel attacks, etc. Some of the criteria are at odds with each other so no one curve could satisfy them all. It was noted that different curves might be needed for different applications.

In a Session on Hardware and Implementation, we were warned that some hardware implementations made assumptions about curves (like prime order) that may not hold with new curves. It may not be realistic to expect that all hardware vendors will add support for all new curves.

The group heard about an efficient implementation of the NIST P-256 curve in software, and some new curves: Ed448 (also known as Goldilocks), curve 41417, and FourQ. Each has certain performance or security advantages over others.

Stephen Farrell represented the IETF and its Crypto Forum Research Group (CFRG). He said that the IETF has long been dependent on NIST. But after the Snowden revelations, many in the IETF including the CFRG expressed distrust in the NIST curves and concerns about known side-channel attacks on them. The IETF’s Transport Layer Security (TLS) Working Group made a formal request to the CFRG to come up with alternatives. The CFRG held a public comment period which proved a lot more contentious than expected, but they have decided on 25519 and the Goldilocks curve.

Farrell said that ideally, IETF would have adopted new curves from NIST but the CFRG felt it could not wait that long. So Farrell suggested that the best way to avoid chaos would be for NIST to formally adopt 25519 and Goldilocks as new ECC standard curves. In his opinion, there’s not enough time to innovate on new curves. He urged NIST to at least make a statement about its intentions. He also said that “Intellectual Property Rights (i.e. patents) for any crypto will kill it off.”

NIST was urged to keep P-256 as an approved standard, since many IoT applications are already using it and will likely continue to use it.

Should NIST take leadership here? Most folks thought yes, otherwise geographical fragmentation might result. It was noted that some countries are pushing vendors to deploy their own national crypto algorithms.

We adjourned with the admonition to “keep the discussion going”, but I sensed very little consensus in the room. Current NIST curves will continue to be used in some applications where they are already embedded or there is less concern about their trustworthiness. New curves will make their way into IETF protocols and eventually to browsers, web servers and Certificate Authorities.  My guess is that we have several years before Certificate Authorities have to consider expanding our product portfolio to include new ECC curves.

[This page][1] contains links to all the presentations.

 [1]: http://www.nist.gov/itl/csd/ct/ecc-workshop.cfm
 [2]: http://csrc.nist.gov/groups/ST/ecc-workshop-2015/presentations/session2-andrews-rick.pdf