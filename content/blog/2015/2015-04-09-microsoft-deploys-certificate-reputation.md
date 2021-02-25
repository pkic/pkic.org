---
authors:
- Bruce Morton
date: "2015-04-09T19:00:24+00:00"
dsq_thread_id:
- 3662223644
keywords:
- ssl
- identity
- mis-issued
- google
- microsoft
- extended validation
tags:
- SSL/TLS
- Identity
- Mis-issued
- Google
- Microsoft
- EV
title: Microsoft Deploys Certificate Reputation


---
As we have stated previously, website owners have a concern that an attacker can have a certificate issued for their domain name. We now have two systems which will help monitor certificates for domains: [Certificate Transparency (CT)][1] and [Certificate Reputation][2].

At the start of 2015, most certification authorities (CAs) support CT as [requested by Google][3]. CT works for extended validation (EV) SSL certificates and will allow all EV certificates to be monitored.

In March 2015, Microsoft deployed Certificate Reputation. Through the use of Windows, Internet Explorer and other applications, certificate data for all types of SSL certificates is collected and provided to Microsoft. In addition, Microsoft has stated that they don’t collect any information that could be used to identify the user.

The certificate data is only provided to users who can confirm [ownership of the domain][4]. The data is provided through [Bing Webmaster Tools][5] and shows data similar to the image below.

{{< figure src="/uploads/2015/04/certificate-reputation.png" >}} 

The data includes identity information such as the name of the server (**Host**), the name of the entity (**Issued to**), and the name of the CA (**Issued by**). It provides data on how long the certificate has been available (**First seen** and **Last seen**) and its validity (**Expiry date**). It allows the user to download the certificate (**Download**) and report fraudulent certificates to Microsoft (**Report**).

In the short-term, there appears to be advantages of Certificate Reputation as it works for all types of SSL certificates and not just EV. It works for all CAs, as the CAs do not need to participate in the Certificate Reputation program. Certificate Reputation is also available to all administrators as Microsoft is providing the information through a portal.

From the disadvantage side, it only provides data from Windows and its applications; however, this should provide a substantial use base.

We are seeing more occurrences of mis-issued certificates, such as [the recent problem with CNNIC][6].  It is recommended that domain owners use Certificate Reputation to monitor their domains. In the future, we expect that Microsoft will upgrade the service to provide email notification when a new certificate has been found.

 [1]: https://casecurity.org/2013/09/09/what-is-certificate-transparency-and-how-does-it-propose-to-establish-certificate-validity/
 [2]: https://casecurity.org/2014/03/28/certificate-reputation/
 [3]: http://www.certificate-transparency.org/ev-ct-plan
 [4]: http://www.bing.com/webmaster/help/getting-started-checklist-66a806de
 [5]: http://www.bing.com/toolbox/webmaster
 [6]: https://casecurity.org/2015/04/02/fighting-the-good-fight-for-online-trust/