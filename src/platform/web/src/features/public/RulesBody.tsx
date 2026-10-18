import type { ReactNode } from 'react';

const MAX_DEPTH = 4;

function depthOf(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return 1 + children.reduce<number>((max, child) => Math.max(max, depthOf(child)), 0);
}

function scalar(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderValue(value: unknown): ReactNode {
  if (Array.isArray(value)) {
    return <ul className="pub-kv-list">{value.map((item, index) => <li key={index}>{renderValue(item)}</li>)}</ul>;
  }
  if (value !== null && typeof value === 'object') {
    return <dl className="pub-kv">{Object.entries(value as Record<string, unknown>).map(([key, child]) => <div key={key}><dt>{key}</dt><dd>{renderValue(child)}</dd></div>)}</dl>;
  }
  return scalar(value);
}

/** Renders a rules-section body: JSON objects/arrays as a key–value structure, everything else as the original text. */
export function RulesBody({ body }: Readonly<{ body: string }>) {
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object' && depthOf(parsed) <= MAX_DEPTH) {
        return <div className="pub-rules-body" data-structured="true">{renderValue(parsed)}</div>;
      }
    } catch { /* not JSON: show the raw text */ }
  }
  return <p>{body}</p>;
}
