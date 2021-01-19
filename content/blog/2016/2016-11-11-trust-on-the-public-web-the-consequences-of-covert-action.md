---
title: Trust on the Public Web – The Consequences of Covert Action
authors: [Dean Coclin]
date: 2016-11-11T20:38:03+00:00
dsq_thread_id:
  - 5297030218


---
You may have heard in the news that the Chinese Certificate Authority, WoSign, was caught backdating SHA-1 certificates to make it look like they were issued before the December 31, 2015 deadline. Why is this newsworthy?  For web-based security to remain an integral part of an ecosystem used every day by millions of people around the world, it all comes down to Trust; trust in the organization issuing the certificates, trust in the browsers that validate and display certificate information to the user, and trust by relying parties browsing web pages secured by certificates. Without trust, worldwide commerce and security on the web are at risk.

Initially, WoSign denied these allegations but later, after Mozilla uncovered forensic evidence, they admitted in a published [report][1] that they had indeed backdated 64 certificates. In addition, WoSign mis-issued several certificates for unauthorized domains. Lastly, WoSign purchased Startcom, an Israeli CA, without notifying the browsers of this transaction. These and other faults have been discussed in a Mozilla [document][2] where community input was taken into account before a proposed plan of action was produced.

Mozilla has decided to distrust 4 WoSign roots and 2 Startcom roots as well as require Certificate Transparency (CT) for all new certificates going forward. CT has proven itself as an effective means for monitoring all certificates issued by Certificate Authorities. Existing WoSign/Startcom certificates will be trusted, but any certificate issued after October 21, 2016 will not show up as trusted starting with Firefox version 51. WoSign/Startcom are free to apply for inclusion of new roots after June 1, 2017, but must also make certain changes to their operations, policies and audits. Mozilla has outlined these changes in a bug report for [WoSign][3] and a separate one for [Startcom][4]. These are more concisely summarized in Mozilla’s [Blog][5].

In addition, Apple has [stated][6] they will no longer trust the WoSign CA Free SSL Certificate G2 intermediate CA certificate that issues certificates after September 19, 2016. Lastly, Google [announced][7] that starting with Chrome version 56, Google will phase out trust for WoSign and Startcom root certificates.

In practicality, what does this all mean? WoSign have already [announced][8] they will still sell certificates — presumably by either reselling another public CA’s certificates or by licensing a subCA from a publicly trusted root.  The management of WoSign is being changed.  Mozilla, Google, and Apple’s actions are the first step in restoring trust in the ecosystem from an ecosystem participant caught not playing by the rules. Other browsers have yet to announce their plans, but we expect similar actions to follow.

Owners of certificates from these entities should likely seek to replace them with new providers due to the uncertainty with the trustworthiness of their current CA.

 [1]: https://www.wosign.com/report/WoSign_Incident_Report_Update_07102016.pdf
 [2]: https://docs.google.com/document/d/1C6BlmbeQfn4a9zydVi2UvjBGv6szuSB4sMYUcVrR8vQ/edit
 [3]: https://bugzilla.mozilla.org/show_bug.cgi?id=1311824
 [4]: https://bugzilla.mozilla.org/show_bug.cgi?id=1311832
 [5]: https://blog.mozilla.org/security/2016/10/24/distrusting-new-wosign-and-star
 [6]: https://support.apple.com/en-us/HT204132
 [7]: https://security.googleblog.com/2016/10/distrusting-wosign-and-startcom.html?m=1
 [8]: https://www.wosign.com/english/News/announcement_about_Mozilla_Action_20161024.htm