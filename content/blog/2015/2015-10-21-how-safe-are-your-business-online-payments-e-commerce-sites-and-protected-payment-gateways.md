---
authors:
- CA Security Council
date: "2015-10-21T15:07:49+00:00"
dsq_thread_id:
- 4245903980
keywords:
- ssl
- https
- google
- encryption
tags:
- SSL/TLS
- Google
- Encryption
title: 'How Safe Are Your Business’ Online Payments?: E-Commerce Sites and Protected
  Payment Gateways'


---
_This blog was originally posted on [staysafeonline.org](http://staysafeonline.org/) on June 29, 2015._

* * *

Online payments can be made in a variety of ways, but majority of the online financial transactions are done through secured payment gateways. Secure payment gateways, as the name suggests, are application service providers for ecommerce websites that authorize various financial transactions taking place on online stores for ensuring safety for both the retailers and the online buyers. The key goal of payment gateways is to secure personal information like cconsumers’ credit card numbers by encrypting their personal and confidential information. Learn more about what these gateways are and how they help protect your online transactions.

### What is a Payment Gateway?

A payment gateway is a software layer that helps pass sensitive information between an online store and a bank by encrypting the confidential information so that online transactions can be accomplished safely in real time.. A payment gateway is like an online version of POS (Point of Sale), which stores use for taking payments from their customers.

### What is PCI-DSS?

PCI-DSS, also known as the Payment Card Industry Data Security Standard, is a set of procedures and policies designed to optimize the safety of debit, credit and cash card transactions and protect cardholders’ personal information from unauthorized access.

### How Do Payment Gateways Work?

{{< figure src="/uploads/2015/10/How-Safe-Are-Your-Online-Payments-2015_6_29-2.png" >}} 

Payment gateways enter the transaction cycle at a number of stages. When you “check out” on an e-commerce site, the proecess only takes a few seconds, but it actually follows several steps managed by the payment gateway, highlighted here:

  1. A customer places an order by clicking the Checkout button and is directed to the payment page where he/she has to provide credit or debit card information.
  2. Once the information is entered, the web browser will encrypt the information by its built-in encryption protocol, HTTPS (Hypertext Transport Protocol Secure), which sends the data to the merchant’s web server.
  3. The merchant further processes the data to its payment gateway server using [SSL (Secure Socket Layer)](http://searchsecurity.techtarget.com/definition/Secure-Sockets-Layer-SSL) encryption.
  4. The payment gateway forwards the information to the payment processor used by the merchant’s acquiring bank.
  5. The payment processor sends the details to the card association, which can sometimes act as the issuing bank as well, in which case a straightaway response of “approved” or “declined” is sent to the payment gateway. Otherwise, the card association routes the transaction data to the card-issuing bank to get a response.
  6. The credit card-issuing bank gets an authorization request and checks the credit and debit balance. It transmits a response to the payment processor with some code indicating the state of the response, such as approved or denied. If the transaction is denied, then the reason for the denial (such as insufficient balance or bank link not available) is also attached to the code.
  7. The payment processor sends the response to the payment gateway. If the response is positive, it will be added to the merchant’s other approved transactions.
  8. The payment gateway delivers the authorization response to the website to complete or reject the transaction.

There are two major types of payment gateway categories ‒ hosted and non-hosted.

With a hosted payment gateway, when a customer checks out, he/she is directed away from that website to the payment gateway website page. At the payment page, the customer is asked to enter the transaction details or credit card details on the payment service provider page. Once,the customer makes the payment, he/she is again redirected to the merchant’s website. The advantage of these types of payment gateways, used by such companies as PayPal, Worldpay and Nochex, is that this payment gateway does not require the merchant ID because any of the client’s important or vulnerable information is not gained in the merchant’s website.

Some merchants do not like to divert their customers’ attention from their website and, therefore, may choose non-hosted payment gateways. In a non-hosted payment gateway such as eWay’s website, customers can directly enter their transaction information on payment page while the payment page is controlled by the payment protection gateway with complete safety assurance. Once the customer has entered the card details and other important transaction information, he/she is taken back to the merchant’s site. This type of payment gateway can save customers time due to not being redirected to another website.

## What Gateway Plan Should Your Business Choose?

The market offers many secured server hosting payment gateway plans ‒ each with their own advantages and drawbacks. Here are some important criteria to consider before choosing the ideal plan for your business:

  * Check out the fees of each gateway plan you are considering. Some payment gateway service providers demand  fixed monthly charges, whereas another type takes a percentage of the total monthly transaction. Depending on how many transactions your business sees each month, one of these options may be more profitable.
  *  The responsibility of the security of your business website falls solely upon your shoulders. A properly secured gateway plan promises profit in the long run. Research the security of the plan you are considering, looking at whether it uses [SSL certification for data encryption](https://www.rosehosting.com/blog/install-an-ssl-certificate-on-a-linux-vps-with-the-directadmin-control-panel/), asks for CVV2 verification, uses transaction billing and/or has any other security benefits.
  * Not every gateway may support the type of products your business sells. List the products you will sell on your website and research which plans support them before choosing.

For more information on helping to secure your business’ information and protect your customers, see the [RE: Cyber](https://www.staysafeonline.org/re-cyber) pages.

### About the Author

Joy Mali is a certified digital analyst who helps online businesses to perform better on the web with best solutions & advice. Her content is featured on many mainstream sites and blogs. You can follow her [on Google+](https://plus.google.com/u/0/116733756592169232053/about).