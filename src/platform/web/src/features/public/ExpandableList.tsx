import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface ExpandableListProps<T> {
  items: readonly T[];
  initial: number;
  step: number;
  renderItem: (item: T, index: number) => ReactNode;
  label: string;
  emptyText: string;
  listTag: 'ul' | 'ol';
  summary?: string;
  scrollMaxHeight?: number;
  /** Scroll region whose height comes from the surrounding layout (CSS) instead of an inline max-height. */
  fill?: boolean;
}

export function ExpandableList<T>({ items, initial, step, renderItem, label, emptyText, listTag: Tag, summary, scrollMaxHeight, fill }: ExpandableListProps<T>) {
  const listId = useId();
  const [requested, setRequested] = useState(initial);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'collapse' | 'more' | null>(null);
  const visible = Math.min(requested, items.length);
  const remaining = items.length - visible;
  const expanded = visible > initial;
  useEffect(() => {
    if (refocus.current === 'collapse' && remaining === 0) collapseRef.current?.focus();
    if (refocus.current === 'more') moreRef.current?.focus();
    refocus.current = null;
  });
  if (items.length === 0) return <p className="pub-muted">{emptyText}</p>;
  const list = <Tag id={listId} className="pub-list">{items.slice(0, visible).map(renderItem)}</Tag>;
  return <>
    {summary && <p className="pub-muted pub-list-summary">{summary}</p>}
    {fill ? <div className="pub-scroll pub-scroll--fill" role="region" tabIndex={0} aria-label={label}>{list}</div>
      : scrollMaxHeight === undefined ? list
        : <div className="pub-scroll" role="region" tabIndex={0} aria-label={label} style={{ maxHeight: scrollMaxHeight }}>{list}</div>}
    {(remaining > 0 || expanded) && <div className="pub-list-actions">
      {remaining > 0 && <button type="button" ref={moreRef} className="ui-button ui-button--secondary" aria-expanded={expanded} aria-controls={listId}
        onClick={() => { refocus.current = 'collapse'; setRequested(visible + step); }}>Xem thêm ({remaining} còn lại)</button>}
      {expanded && <button type="button" ref={collapseRef} className="ui-button ui-button--secondary" aria-expanded aria-controls={listId}
        onClick={() => { refocus.current = 'more'; setRequested(initial); }}>Thu gọn</button>}
    </div>}
  </>;
}
