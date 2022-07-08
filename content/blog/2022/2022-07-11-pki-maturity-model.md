---
title: What is the PKI Maturity Model (PKIMM) and how you can contribute?
summary: The PKI Consortium recently established the PKI Maturity Model Working Group to build a PKI maturity model that will be recognized around the globe as a standard for evaluation, planning, and comparison between different PKI implementations. In this blog post we will tell you more about why we are building the model and how you can contribute to it.
authors: [Roman Cinkais]
date: 2022-07-11T09:00:00+00:00
categories:
keyword: [pki, maturity, model, assessment, improvement, evaluation, comparison, performance, capability, ability]
tags: [PKIC, PKIMM, Maturity model]

---

Recently the PKI Consortium established the [PKI Maturity Model Working Group](/wg/pkimm/) to build a PKI maturity model for evaluation, planning, and comparison between different PKI implementations.

Whereas publicly trusted PKI and certification authorities adhere to  internationally recognized standards such as WebTrust and eIDAS or defined by organizations such as The CA/Browser Forum,, it does not mean that the PKI implementation is necessarily fully mature and there may still be areas of improvement.

The private PKI, which finds more and more use-cases nowadays, is not usually audited and is often purpose built with the support of certificates with custom data, extensions, or policies that do not fit any existing standard.

The PKI Maturity Model helps to evaluate PKI implementations and guides improvement to overall maturity and trust.

## What is a maturity model?

Maturity models measure the capability and ability of an organization or implementation for the continuous improvement and evolution in a specific area. The PKI maturity model focuses on the specifics of a Public Key Infrastructure (PKI) implementation and helps identify the maturity and improvements that can be made.

The PKI Maturity Model is a technologically independent model that evaluates aspects of and activities related to the PKI (people, process, technology) according to specific categories. The overall maturity level of a PKI is determined based on the maturity of the categories and is independent of the size of the organization and the use case.

Each category is tailored to provide a deterministic approach to calculate the maturity based on the expert system, questions and responses supported by inputs and evidence.

The overall PKI maturity level is therefore calculated from partial maturity levels of categories.
See the following diagram representing the calculation of the overall maturity level:

```goat
             .------------------.
            | PKI Maturity Level |
             '------------------'
                        ^
                        |
      .--------------+--+------------------.
      |              |                     |
.-----+-----.  .-----+-----.         .-----+-----.
| Category1 |  | Category2 |   ···   | CategoryN |
'-----------'  '-----------'         '-----------'
                    ^
                    |
         .----------+---+---------------------.
         |              |                     |
   .-----+-----.  .-----+-----.         .-----+-----.
   | Question1 |  | Question2 |   ···   | QuestionN |
   '-----------'  '-----------'         '-----------'
         ^              ^                     ^
         |              |                     |
         .--------------+---------------------.
                               ^
                               |
                   .-----------+----------.
                  | Inputs, evidence, etc. |
                   '----------------------'
```

## Why are we building the model?

There is currently no standardized and globally recognized maturity model for PKI. Some available models are very specific and built on top of frameworks like Capability Maturity Model Integration ([CMMI](https://en.wikipedia.org/wiki/Capability_Maturity_Model_Integration)), working for specific purposes of the consulting companies.

Our goal is to build a PKI maturity model that will be recognized around the globe as a standard for evaluation, planning, and comparison between different PKI implementations. It can also serve as a basis for additional services connected with the model, like PKI maturity assessment, or implementation and definition of action plans for PKI environments.

The PKI maturity model should provide the following:

- Quickly understand the current level of capabilities and performance of the PKI
- Support comparison of PKI maturity with similar organizations based on size or industry
- Improvement strategy for the current PKI state
- Improve overall PKI performance and ability to meet the requirements of the industry

## Resources and contribution

Anyone is more than welcome to contribute to the PKI maturity model. The model is open and available for anyone to use.

The following public resources are available:

| Resource                                                                                                | Description                                                                                                                                     |
|---------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| [Charter](https://pkic.org/wg/pkimm/charter)                                       | PKI Maturity Model Working Group Charter describing our objectives and activities.                                                              |
| [GitHub](https://github.com/pkic/pkimm)                                                       | Primary repository for the model. You can find here the current documentation of the model, assessment methodology, and other.                  |
| [Discussions](https://github.com/pkic/community/discussions/categories/pki-maturity-model-pkimm) | Discussion forum for the PKI maturity model, open to anyone, if you would like to start a discussion or just ask a question related to the model. |

The PKI maturity model is not targeting a specific PKI, it serves as a standard for PKI maturity assessments and helps to identify areas for improvement, unrelated to the scope and whether the PKI is private, public, shared, bridged, etc. It is therefore important for the PKI Consortium to make the model available to the public, free of charge, and establish a community of people who are interested in the model.

Feedback and continuous improvement is the key to the success of the PKI Maturity Model.
