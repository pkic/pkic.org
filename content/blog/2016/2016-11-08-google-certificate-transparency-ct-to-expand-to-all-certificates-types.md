---
title: Google Certificate Transparency (CT) to Expand to All Certificates Types
authors: [Jeremy Rowley]
date: 2016-11-08T17:50:31+00:00
dsq_thread_id:
  - 5288911081


---
### _The policy change goes into effect October 2017_

A recent Google announcement stated that all publicly trusted SSL/TLS certificates issued in October 2017 or later will be expected to comply with Chrome’s Certificate Transparency (CT) policy or be untrusted by the browser.

Since January 2015, Chrome has required Extended Validation (EV) certificates to comply with CT. With this policy change, the Chrome CT policy will also apply to Domain Validated (DV) and Organization Validated (OV) certificates.

For more than two years, CAs have supported CT for EV certificates while preparing for when CT would become mandatory for OV and DV certificates. We applaud Chrome’s decision in making CT mandatory and view CT as vital in identifying early mi-issuance of certificates. The transparency of CT improves the integrity of Certificate Authority (CA) practices and provides additional protections for domain holders.

While this is a positive step forward for the industry, we feel that there is still important work to do before the October 2017 deadline to assure CT accommodates European privacy concerns and meets the interests of the security community and domain holders. Luckily, the IETF is already working towards a solution to help prevent wised-spread disclosure of potentially personal information. If implemented, name redaction will provide companies the following benefits:

Product Development: Some companies use DNS as a network map, which can reveal new projects worked on that are not yet ready for public view. Absent name redaction, some companies may publicly end up disclosing more corporate structure information than intended and spoiling the reveal. Name redaction can help keep the project secret until the appropriate launch time while still allowing participants to communicate through standard browser layouts. This is vital in telecommuting and companies with remote structures.

Privacy: Certificates may include personal information about a company or their staff. Redacting this information would provide important protection. For example, many websites are run by individuals or sole proprietorships. These domain operators include their name, address, and (sometimes) email address in the certificate. Making this information readily available in a CT log provides marketers easier means of fanning contact information and sending spam. There’s also an issue that the information can never be removed from a CT log, making it impossible to remove the details from the public limelight.

CASC members remain committed to advancing Internet security standards and practices that protect online trustworthiness. In doing so, we feel it important to balance the legitimate needs of organizations in protecting their trade secrets and maintaining business advantages.

### About Jeremy Rowley

As Executive Vice President of Emerging Markets Jeremy Rowley leads the company’s business and product development teams serving its emerging markets clients that require security solutions for the Internet of Things, U.S. federal healthcare exchange, advanced Wi-Fi and other innovative technology sectors. Rowley also represents DigiCert’s interests within various industry standards bodies and has authored several industry standards now in use. As part of DigiCert’s vision to lead its industry toward better and more trusted practices, Rowley actively participates in groups such as the CA/Browser Forum, IETF, Mozilla Forum, NIST, ICANN, and the CA Security Council and he continues to draft new policy and guidelines today.