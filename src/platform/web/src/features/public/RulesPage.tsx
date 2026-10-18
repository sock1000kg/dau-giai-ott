import type { PublicSnapshot } from './snapshot.ts';

export function RulesPage({ rules }: { rules: PublicSnapshot['rules'] }) {
  return <section aria-label="Luật hiện tại"><h2>Luật hiện tại</h2>
    <p>Phiên bản {rules.version} · Engine {rules.engineVersion}</p>
    {rules.sections.map((row, index) => <article key={index}><h3>{row.title}</h3><p>{row.body}</p></article>)}
  </section>;
}
