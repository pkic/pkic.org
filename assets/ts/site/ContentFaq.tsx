import "../../design/tokens.content.generated.css";
import "./ContentFaq.css";

export interface ContentFaqGroup {
  id?: string;
  title?: string;
  questions: Array<{ answerHtml: string; id: string; open: boolean; question: string }>;
}

/**
 * Frequently asked questions as native disclosures: each question expands in place, keeps its
 * own permalink, and works with the keyboard and assistive technology without a script.
 */
export function ContentFaq({ groups }: { groups: ContentFaqGroup[] }) {
  return (
    <div class="pk-content-faq">
      {groups.map((group, groupIndex) => (
        <section key={group.id ?? groupIndex} aria-labelledby={group.id}>
          {group.title ? <h2 id={group.id}>{group.title}</h2> : null}
          <div class="pk-content-faq__items">
            {group.questions.map((item) => (
              <details key={item.id} id={item.id} class="pk-content-faq__item" open={item.open}>
                <summary class="pk-content-faq__question">{item.question}</summary>
                <div class="pk-content-faq__answer" dangerouslySetInnerHTML={{ __html: item.answerHtml }} />
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
