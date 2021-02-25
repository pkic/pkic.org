---
authors:
- Dean Coclin
date: "2013-08-07T18:18:01+00:00"
dsq_needs_sync:
- 1
dsq_thread_id:
- 1980218040
keywords:
- domain validated
- ssl
- identity
- phishing
- encryption
- ev certificate
tags:
- DV
- SSL/TLS
- Identity
- Phishing
- Encryption
- EV
title: What Are the Different Types of SSL Certificates?


---
---
## Domain Validation (DV)

A Domain Validated SSL certificate is issued after proof that the owner has the right to use their domain is established. This is typically done by the CA sending an email to the domain owner (as listed in a WHOIS database). Once the owner responds, the certificate is issued. Many CAs perform additional fraud checks to minimize issuance of a certificate to a domain which may be similar to a high value domain (i.e. Micros0ft.com, g00gle.com, b0fay.com). The certificate only contains the domain name. Because of the minimal checks performed, this certificate is typically issued quicker than other types of certificates. While the browser displays a padlock, examination of the certificate will not show the company name as this was not validated.

## Organizational Validation (OV)

For OV certificates, CAs must validate the company name, domain name and other information through the use of public databases. CAs may also use additional methods to insure the information inserted into the certificate is accurate. The issued certificate will contain the company name and the domain name for which the certificate was issued. Because of these additional checks, this is the minimum certificate recommended for ecommerce transactions as it provides the consumer with additional information about the business.

## Extended Validation (EV)

EV Certificates are only issued once an entity passes a strict authentication procedure. These checks are much more stringent than OV certificates. The objectives are twofold: First, **identify the legal entity that controls a website:** Provide a reasonable assurance to the user of an Internet browser that the website the user is accessing is controlled by a specific legal entity identified in the EV Certificate by name, address of place of business, jurisdiction of incorporation or registration and registration number or other disambiguating information.  Second, **enable encrypted communications with a website:** Facilitate the exchange of encryption keys in order to enable the encrypted communication of information over the Internet between the user of an Internet browser and a website (same as OV and DV).

The secondary purposes of an EV Certificate are to help establish the legitimacy of a business claiming to operate a website or distribute executable code, and to provide a vehicle that can be used to assist in addressing problems related to phishing, malware, and other forms of online identity fraud. By providing more reliable third-party verified identity and address information regarding the business, EV Certificates may help to:

  1. Make it more difficult to mount phishing and other online identity fraud attacks using Certificates. 
  2. Assist companies that may be the target of phishing attacks or online identity fraud by providing them with a tool to better identify themselves to users.
  3. Assist law enforcement organizations in their investigations of phishing and other online identity fraud, including where appropriate, contacting, investigating, or taking legal action against the subject. 

Because of the strict vetting procedures that CAs use to check the information about the applicant, the issuance of EV certificates usually takes longer than other types of certificates. An overview of this vetting process can be found here: <https://www.cabforum.org/vetting.html>. The resultant EV SSL certificate will contain the information here: <https://www.cabforum.org/contents.html>.

##  Features of the three types of certificates

|Type of cert|Domain validated?|Company Name Validated?|Address Validated?|Pad Lock Displayed in Browser User Interface?|Green address bar and other special treatment?|Typical relative price|
|------------|:---------------:|:---------------------:|:----------------:|:-------------------------------------------:|:--------------------------------------------:|:--------------------:|
| **DV**     |      X          |                       |                  |                   X                         |                                              |      $               |
| **OV**     |      X          |           X           |        X         |                   X                         |                                              |      $$              |
| **EV**     |      X          |           X           |        X         |                   X                         |                      X                       |      $$$             |
