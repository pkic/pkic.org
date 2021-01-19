---
title: CAs Support Standards and Regulations
authors: [Bruce Morton]
date: 2013-05-10T19:40:27+00:00
dsq_thread_id:
  - 1997020829


---
There is an industry myth that certification authorities (CAs) are not regulated. In fact publicly-trusted SSL CAs support the development of industry regulations and have been audited annually to ensure compliance to the many requirements.

To provide some history, SSL CAs have always self-policed themselves by having external audits performed. In the &lsquo;90s, the CAs wrote certificate policies and certification practice statements requiring annual compliance audits. Since there were no CA audit criteria, the CAs contracted for [SAS 70 audits][1].

In 2000, the [AICPA and CICA developed the WebTrust for CA audit criteria][2]. The CAs switched to being audited to meet the WebTrust criteria and many browsers required successful WebTrust for CA audits to maintain root certificates embedded in their software.

In 2005, the CAs and the browsers combined to form the [CA/Browser Forum][3]. The purpose was to improve the issuance and management of SSL certificates. The first release was the Extended Validation (EV) SSL certificate requirements and in 2007, the issuing CAs were audited in accordance with the WebTrust for EV criteria.

However, the EV criteria did not cover standards for non-EV certificates. The CA/Browser Forum addressed this problem by developing the Baseline Requirements for SSL certificates. In 2012, the CAs started issuing certificates meeting the Baseline Requirements and in 2013 those CAs will be audited to the SSL Baseline Audit criteria, which was also developed by WebTrust personnel.

Now, when SSL CAs display their audit results, expect to see WebTrust for CA, WebTrust for EV and Baseline Requirements reports.

In addition to improving the CA certificate issuance and management standards, the CA/Browser forum has also introduced Network and Certificate System Security Guidelines which is hoped to be added to the audit criteria in the future. Also the [European Telecommunications Standards Institute (ETSI)][4] has adopted the CA audit criteria and has updated their standards.

For more information on SSL CA audits and other standards that help regulate the industry, please see [the CASC whitepaper][5].

Bruce Morton, Entrust

 [1]: https://en.wikipedia.org/wiki/Statement_on_Auditing_Standards_No._70:_Service_Organizations
 [2]: http://www.webtrust.org/homepage-documents/item27839.aspx
 [3]: https://www.cabforum.org/documents.html
 [4]: http://www.etsi.org
 [5]: /uploads/2013/04/Standards-and-Industry-Regulations-Applicable-to-Certification-Authorities.pdf