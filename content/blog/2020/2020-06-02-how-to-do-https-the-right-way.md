---
title: How to do HTTPS … The Right Way
summary: With secure HTTP — aka HTTPS (the “S” is short for “secure”) — swiftly becoming universal on the Internet, it is important to know how to configure HTTPS for your website the right way. The payoff for properly securing your website has many benefits.
authors: [Corey Bonnell]
date: 2020-06-02T14:30:09+00:00
tags: [SSL/TLS, CAA, Site Seal]

---
With secure HTTP &mdash; aka HTTPS (the “S” is short for “secure”) &mdash; swiftly becoming universal on the Internet, it is important to know how to configure HTTPS for your website the right way. The payoff for properly securing your website has many benefits, a few of which are:

- Secure transmission of sensitive information. HTTPS protects the sensitive information of your website visitors– whether that be personal profile information, passwords, payment information, etc. Additionally, electronic payment standards such as [PCI DSS](https://securetrust.blog/2020/04/27/apply-critical-thinking-to-security-and-compliance/) mandate the use of HTTPS when collecting payment information.
- Increased customer confidence. Browsers commonly display padlock icons or the word “Secure” when secured with HTTPS, giving visitors confidence to purchase products online. Conversely, browsers also display warnings to users when a non-HTTPS website is visited. Such warnings scare off potential customers and can lead to lost sales.
- Search engine optimization. Search engines list websites that are secured with HTTPS higher in search results, which means customers can more easily find your website or e-commerce site.
- While the benefits are compelling, they do not matter if your server is not configured correctly. Furthermore, it is difficult to know where to get started securing your website.

To alleviate these difficulties, the first step is to partner with a trusted Certificate Authority who can guide you through the choice of digital certificate types, certificate validation, the issuance process, and installing the certificate on your web server. Some Certificate Authorities offer free certificates, but beware: these free offerings come without any personalized technical support and have potentially onerous restrictions on the number of certificates that you can issue. By partnering with a trusted Certificate Authority, you can rest assured that you will receive personalized assistance from a support representative to overcome any challenges that are encountered when securing your website and assist you with properly configuring HTTPS.

Once your certificate is installed on your web server there are three additional steps to secure your website:

- Configure your domain to allow only your selected Certificate Authority to issue certificates
- Use a TLS security scanner to ensure proper server configuration
- Add a Site Seal to your e-commerce website to increase customer confidence
- Configure Certificate Authority Authorization (CAA)

After you have selected a Certificate Authority, the next step is to protect your domain name with CAA records. These records allow only your selected Certificate Authority to issue certificates for your domain. All Certificate Authorities must abide by the CAA records that you configure for your domain, so you can ensure that only trustworthy Certificate Authorities can issue certificates.

## Scan Your Site

Once you have installed the certificate issued by your Certificate Authority on your web server, it is time to check that your web server is configured properly to allow for visitors to securely visit your website. This is done by utilizing TLS security scanning tools. These tools perform extensive tests of your web server and provide detailed, actionable results that can greatly increase the security of your website and compatibility with popular browsers and mobile devices.

## Add Site Seal

Finally, after you have successfully installed your certificate, adding your Certificate Authority’s seal to your e-commerce website is a striking way to convey trust to your potential customers. Customers will be presented with a clickable and interactive seal that will list your organization name and other information that provide your organizational identity. In a world where phishing and fake websites are increasingly rampant online, these seals provide vital identity information, so your customers can proceed with their purchase in confidence.