---
authors:
- Kirk Hall
date: "2013-11-22T18:00:15+00:00"
dsq_thread_id:
- 1987547004
keywords:
- domain validation
- ca/browser forum
- organization validation
- cps
- ssl
- identity
- https
- phishing
- ov certificate
- extended validation
- ev certificate
- certificate signing request
- dv certificate
tags:
- DV
- CA/Browser Forum
- OV
- Policy
- SSL/TLS
- Identity
- Phishing
- EV
- CSR
title: How Organizations Are Authenticated for SSL Certificates


---
Certification Authorities (CAs) are trusted third parties that authenticate customers before issuing SSL certificates to secure their servers.

Exactly how do CAs authenticate these organizations? And where are the rules that determine what CAs must do during authentication?

### The Rules on Customer Authentication

In the past, there were no common rules applicable to CAs as to minimum steps required to authenticate a customer before issuing an SSL certificate. Instead, each CA was permitted to create its own authentication processes, and was only required to describe the process in general terms in its public Certification Practice Statement (CPS). In many cases, the CPS authentication description was vague and hard to understand, and some CAs were less diligent than others during authentication.

To raise the bar for customer authentication, CAs first developed new, common, more stringent authentication standards for their new Extended Validation (EV) certificates, which earn a favorable “green bar” user interface in most browsers and applications. These minimum authentication standards were detailed in the CA/Browser Forum’s 2008 _Guidelines for The Issuance and Management of Extended Validation Certificates_. In 2012, additional authentication requirements were added for all SSL certificates in the CA/Browser Forum’s _Baseline Requirements for the Issuance and Management of Publicly-Trusted Certificates_. See documents at <https://www.cabforum.org/documents.html>. 

All public CAs must follow these same authentication rules when issuing SSL certificates.

### Requirements Common to All Certificates

First of all, there are authentication and technical requirements applicable to all certificates. A CA must check the customer’s certificate signing request to make sure it meets minimum cryptographic algorithm and key size, and is not based on Debian known weak keys. 

A CA must then check the customer and certificate data against a list of high risk applicants (organizations or domains that are most commonly targeted in phishing and other fraudulent schemes), and perform extra authentication steps as appropriate. The CA must also check the customer against internal databases maintained by the CA that include previously revoked certificates and certificate requests previously rejected due to suspected phishing or other fraudulent usage. Finally, the CA must confirm that the customer and its location are not identified on any government denied list of prohibited persons, organizations, or countries.

These basic CA checks are one major advantage of CA-issued certificates over self-signed certificates (including DANE certificates), which are not subject to any similar public safeguards. 

### Simplest Authentication – Domain Validation (DV) Certificates

After these basic checks, the simplest level of authentication occurs for Domain Validation or DV certificates. These certificates do not confirm the identity of the certificate holder, but they do confirm that the certificate holder owns or controls the domains included inside the DV certificate.

DV validation is usually performed using an automated method where the CA sends an email message to the customer containing a confirming URL link and using a limited list of emails addresses. The only email addresses that CAs are allowed to use for domain confirmation are:

  1. Any contact email addresses for the domain shown in the WhoIs record, or
  2. An email addressed to one of five permitted prefixes (admin@, administrator@, hostmaster@, postmaster@, and webmaster@) attached to the domain being confirmed.

The idea is that only a customer that owns or controls a domain can receive and respond to email messages sent to these email addresses. Domain control can also be established by a manual lookup in WhoIs, by requiring the customer to make an agreed-upon change to a web page secured by the domain, or by obtaining confirmation from the domain name registrar.

Some CAs take additional steps during DV validation, such as making an automated telephone call to the customer’s phone number and checking the customer’s credit card number, in order to establish potential points of contact for future reference. The CA is also permitted to insert a country code in the certificate along with all verified domains if the CA has confirmed that the customer’s IP address is associated with the country, but no identifying information about the customer (such as organization name) is included in DV certificates.

The tests listed above – Requirements Common to All Certificates and requiring proof of domain ownership or control in the DNS – are one major advantage of CA-issued certificates over self-signed certificates (including DANE certificates), which are not subject to any similar public safeguards.

### Next Level of Authentication – Organization Validation (OV) Certificates

The next level of customer authentication is for Organization Validation (OV) certificates. OV certificate validation involves all the same steps for DV certificates, plus the CA takes additional steps to confirm the identity and location of the customer and includes the information inside the OV certificate before issuance.

During OV validation, the CA first looks for data confirming the customer’s identity, address, and phone number in any of the following information sources: a third party business data base (such as Dun & Bradstreet), a government business registry (such as the Corporation Commissioner’s website), a letter from a licensed attorney or accountant vouching for the customer’s identity (the CA must follow up to confirm the attorney or accountant is duly licensed and actually signed the letter), or a site visit to the customer by the CA or its agent. A CA can also use a copy of a customer document, such as a utility bill, credit card bill, bank statement, etc. to confirm the customer’s address, but not the customer’s identity.

The CA must then confirm that the contact person who is requesting the OV certificate is really connected with the customer organization (e.g., an employee or agent) that will be listed inside the certificate. To do this, the CA typically places a telephone call to the contact person using a telephone number for the organization found in a public data base (not using a phone number offered by the contact person, which might simply be the person’s mobile phone number). If the contact person representing the organization can be reached through the organization’s main phone number, the link is confirmed and the CA can presume the contact person has authority to order a certificate for the organization. 

Other alternatives for confirming the link between the customer contact person and the organization include mailing a letter or sending a courier package to the person at the organization’s official address with a password that is then entered by the contact person on the CA’s order page, or placing a call to a senior official with the organization to confirm the authority of the contact person to order a certificate.

Once OV authentication has been completed, the CA will include an organization name, city, state or province, and country inside the OV certificate, along with one or more domains the customer owns or controls.

### Highest Level of Authentication – Extended Validation (EV) Certificates

EV certificates represent the highest level of authentication, and are typically rewarded with a favorable user interface by the browsers and applications.

For EV authentication, the CA must conform that the customer’s organization is properly registered as “active” with the appropriate government registry and can also be found in a third party business data base. For companies in existence for less than three years which cannot be found in a business data base, the CA must take additional steps such as requiring an attorney or accountant letter or confirming the customer maintains a bank account.

In addition, the CA must contact the person who signs the Subscriber Agreement (i.e., in most cases, the person who clicks “I Agree” on the CA’s website) to verify the signature, and must independently confirm the name, title, and agency of that person within the organization, typically by finding the person listed as a company officer in a public business data base, by calling the organization’s HR department through a publicly listed telephone number for the organization, or by receiving a confirming attorney or accountant letter that is independently verified. 

The CA must further check the name and domain submitted by the customer to make sure it does not contain a mixed data set (for example, to make sure the Cyrillic letter “a” has not been inserted in place of the Western letter “a”, which can be used for fraudulent purposes). Finally, the EV vetter must compare all authentication data to confirm consistency (e.g., make sure all customer data contains the same address, etc.), and conduct final cross-correlation and due diligence to look for anomalies. The entire vetting file must then be independently reviewed and approved by a second vetter before an EV certificate is issued.

Three percent of all OV and EV vetting files must be reviewed each year by another authorized vetter for quality control purposes.

When an EV certificate is issued, it contains not only the standard OV information fields (organization name, city, state or province, and country), but also the entity type (corporation, government agency, etc.), location of incorporation (state, province, or country), and government registration number so that the customer is uniquely identified to the public. Most browsers display the EV certificate organization name and country of incorporation in the user interface “green bar” visible to the public at the customer’s encrypted **https://** web page secured by the EV certificate.

### Conclusion: CA Authentication Is a Valuable Safeguard for the Public

Because CA certificates are issued from roots trusted by all the major browsers (which provide trust indicators to the public at the customer’s secure pages), it is important that a third party first verify the technical strength of the certificate and the customer’s ownership and control of the domains included in the certificate (for DV certificates), as well as the identity of the customer (for OV and EV certificates). This helps prevent web site impersonation and fraud.

In addition, all CA-issued certificates protect the public in another way — by triggering a browser warning if the domain contained in a certificate does not match the domain visited by the public (so a warning is displayed if someone visits https://www.angel.com and the certificate securing the site is issued to a different domain, www.evil.com). This helps ensure that a user won’t be fooled as to the true domain of the secure web page being visited.