---
authors:
- CA Security Council
date: "2015-11-30T17:51:30+00:00"
dsq_thread_id:
- 4363586650
keywords:
- casc
- malware
- ca/browser forum
- code signing
- identity
tags:
- CASC
- Malware
- CA/Browser Forum
- Code Signing
- Identity
title: Code Signing Baseline Requirements


---
You may have heard that the CA/Browser Forum is getting ready to approve Baseline Requirements for Code Signing certificates. But why is this important?

Let’s back up and get some background on code signing.  Software code that is digitally signed indicates to the user that the code has not been tampered with since it was signed. It also provides authenticity as to who signed it and when.  With the advent of malware, it’s important to insure that the code which was written by the developer is the same code which you downloaded and installed into your computer or mobile phone. A digital signature is like a shrink wrap, protecting the code from modification without detection. Second, the code is signed with a digital certificate issued by a public certificate authority which has performed a verification check on the identity of the author. Malware authors don’t like to be identified, hence the likelihood of a legitimate code signing certificate being issued to a malware author is decreased.

Hard to believe, but until now, there have been no uniform requirements for CAs to follow when issuing code signing certificates. The Baseline Requirements address this deficiency as well as several others. First, all CAs will now perform the same vetting on all applicants across the board. It will be much more difficult for a malware author to “shop” CAs when trying to obtain a code signing certificate.  Second, there have been instances where malware authors are stealing private code signing keys belonging to registered code authors. These keys resided on laptop or desktop PCs and were being harvested via Trojan applications. In most cases the legitimate user was unaware that their key was stolen. The new requirements include a provision for storing keys in hardware, rather than the current software setup. The hardware could be a USB memory stick, cryptographic token or other device. The intention is to physically remove the key from the PC and make it harder to be stolen.

These requirements have been under development for more than 2 years with participation from CAs, Browsers and the public at large in a formal Code Signing Working Group. There have been several public comment periods which resulted in improvement and modification of these requirements. Although not perfect, they represent a good version 1.0 which can be improved in future releases.

The CA Security Council supports the adoption of these Baseline Requirements to help improve code signing and the software ecosystem as a whole. The ballot indicates that if approved, the requirements would be effective on October 1, 2016. However the CASC recommends CAs start implementing them as soon as is practical.