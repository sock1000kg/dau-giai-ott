import { Card } from '../../ui/index.ts';
import type { PublicSnapshot } from './snapshot.ts';
import { RulesBody } from './RulesBody.tsx';
import './public.css';

export function RulesPage({ rules }: { rules: PublicSnapshot['rules'] }) {
  return <section aria-label="Luật hiện tại"><Card as="div" title="Luật hiện tại">
    <p>Phiên bản {rules.version} · Engine {rules.engineVersion}</p>
    <div className="pub-entries">{rules.sections.map((row, index) => <article className="pub-entry" key={index}><h3>{row.title}</h3><RulesBody body={row.body} /></article>)}</div>
  </Card></section>;
}
