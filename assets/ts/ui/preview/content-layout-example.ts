export const contentColumnExample = `## Text that flows across columns

One Markdown body flows down the first column and continues in the next. There are no column items or manual breaks.

::::columns count=2
### Start with a practical question

A working group brings people together around a problem that no single organization can resolve alone. A useful introduction explains what the group is trying to understand, who will benefit from the work, and which decisions the material can help readers make. It gives newcomers a starting point without assuming that they have attended earlier meetings.

The discussion should connect broad goals to concrete situations. A contributor might describe a deployment, a purchase decision, or an operational challenge. Other participants can then compare their experience, identify missing evidence, and agree on the next question to investigate. Examples make the work easier to evaluate and improve.

### Keep the evidence visible

Supporting sources belong close to the claims they explain. A reader should be able to follow a reference, understand its context, and distinguish a published standard from an experiment or a working draft. Clear descriptions help people decide which sources are relevant to their own situation.

The group may reach different conclusions for different environments. Recording the assumptions behind each conclusion is often more useful than presenting one answer without its limits. Describe which observations support the proposal and which questions still need further work. Invite examples that challenge the current approach as well as those that support it.

### Make contributions approachable

A contributor should be able to improve a paragraph, add a reference, or suggest a practical example without rebuilding the page. Shared content components provide the structure while the text remains ordinary Markdown. The same material can be edited visually or reviewed as source.

When a draft is ready for wider discussion, explain what feedback would be most useful. Ask readers to check a particular assumption, test an example, or identify a missing use case. Keep the status of the work visible so that publication does not imply approval. A clear next step turns a static document into the beginning of a useful conversation.
::::

## A compact four-column example

::::columns count=4
**Purpose.** Explain the question the group is working to answer and why it matters to readers.

**Evidence.** Link to the sources and observations that support the proposed approach.

**Discussion.** Invite practical examples and make unresolved questions easy to identify.

**Next step.** Tell readers how to contribute, test an example, or follow the work.
::::`;

export const contentGridExample = `## Separate items in a grid

::::grid count=2
:::item
### Understand the work
Read the methodology and follow the supporting examples.

- Start with the introduction.
- Compare the different approaches.
:::
:::item
### Take part
Bring a practical question or propose an improvement.

[How to contribute](https://example.org/contributing/)
:::
::::

## Cards with shared defaults

::::cards variant=muted
:::card
### Methodology
A common starting point for understanding the work.
:::
:::card variant=accent
### Join the discussion
Help the group answer the next practical question.
:::
:::card variant=default
### Reference library
Sources and supporting evidence collected by the group.
:::
::::`;

export const contentBentoExample = `## A bento grid with icons and a logo

The featured card spans two columns and two rows. Reading order stays the same on a phone. Icons inherit the page accent; logos retain their original colors and proportions.

::::cards layout=bento count=3
:::card span=2 rows=2 icon=shield-check variant=accent
### Build confidence through shared evidence
A working group can bring together methodology, examples, and references in one approachable starting point.

- Explain the purpose and intended audience.
- Keep the supporting material close to the discussion.
- Invite improvements from people using the work in practice.

[Explore the work](https://example.org/methodology/)
:::
:::card icon=users variant=muted
### Contribute your experience
Bring a question from your own environment.
:::
:::card media=logo
![PKI Consortium](/img/logo-color.svg)

### A shared foundation
Every working group uses the same content capabilities.
:::
::::`;

export const contentLayoutExample = [contentColumnExample, contentGridExample, contentBentoExample].join("\n\n");
