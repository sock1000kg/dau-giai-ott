/** Small structural accessibility checker for rendered pages; returns human-readable violations. */

const NAMELESS_INPUT_TYPES = new Set(['hidden']);
const VALUE_NAMED_INPUT_TYPES = new Set(['submit', 'button', 'reset']);

function textOf(root: Element | null): string {
  if (root === null) return '';
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '');
    else if (node instanceof Element && node.getAttribute('aria-hidden') !== 'true') node.childNodes.forEach(walk);
  };
  walk(root);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function byId(root: ParentNode, id: string): Element | null {
  return Array.from(root.querySelectorAll('[id]')).find((el) => el.id === id) ?? null;
}

function labelledBy(element: Element, root: ParentNode): string {
  const ids = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => textOf(byId(root, id))).join(' ').trim();
}

/** Accessible name from aria-labelledby, aria-label, a <label> (for/wrapping), else '' (title is not accepted). */
export function accessibleName(element: Element, root: ParentNode = document): string {
  const byIds = labelledBy(element, root);
  if (byIds !== '') return byIds;
  const aria = element.getAttribute('aria-label')?.trim() ?? '';
  if (aria !== '') return aria;
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    const labels = Array.from(element.labels ?? []);
    const fromLabels = labels.map((label) => textOf(label)).join(' ').trim();
    if (fromLabels !== '') return fromLabels;
    if (element instanceof HTMLInputElement && VALUE_NAMED_INPUT_TYPES.has(element.type)) return element.value.trim();
    return '';
  }
  const text = textOf(element);
  if (text !== '') return text;
  const image = element.querySelector('img[alt]');
  return image?.getAttribute('alt')?.trim() ?? '';
}

const describe = (element: Element) => {
  const id = element.id !== '' ? `#${element.id}` : '';
  const cls = typeof element.className === 'string' && element.className !== '' ? `.${element.className.trim().split(/\s+/).join('.')}` : '';
  return `<${element.tagName.toLowerCase()}${id}${cls}>`;
};

export function checkPage(root: ParentNode = document): string[] {
  const problems: string[] = [];
  const visible = <T extends Element>(selector: string): T[] => Array.from(root.querySelectorAll<T>(selector)).filter((el) => el.closest('[hidden]') === null);

  const mains = visible('main').length;
  if (mains !== 1) problems.push(`expected exactly one main landmark, found ${mains}`);
  const h1s = visible('h1').length;
  if (h1s !== 1) problems.push(`expected exactly one h1, found ${h1s}`);

  for (const control of visible<HTMLElement>('input, select, textarea')) {
    if (control instanceof HTMLInputElement && NAMELESS_INPUT_TYPES.has(control.type)) continue;
    if (accessibleName(control, root) === '') problems.push(`form control without accessible name: ${describe(control)}`);
  }
  for (const button of visible('button')) {
    if (accessibleName(button, root) === '') problems.push(`button without name: ${describe(button)}`);
  }
  for (const link of visible('a[href]')) {
    if (accessibleName(link, root) === '') problems.push(`link without name: ${describe(link)} href=${link.getAttribute('href')}`);
  }
  for (const image of visible('img')) {
    if (!image.hasAttribute('alt')) problems.push(`image without alt: ${describe(image)}`);
  }
  for (const table of visible('table')) {
    if (table.querySelector(':scope > caption') === null && accessibleName(table, root) === '') problems.push(`table without caption or name: ${describe(table)}`);
  }

  const seen = new Map<string, number>();
  for (const el of root.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
  for (const [id, count] of seen) if (count > 1) problems.push(`duplicate id "${id}" x${count}`);

  for (const attribute of ['aria-describedby', 'aria-labelledby']) {
    for (const el of root.querySelectorAll(`[${attribute}]`)) {
      for (const id of (el.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
        if (byId(root, id) === null) problems.push(`${attribute}="${id}" on ${describe(el)} points to a missing id`);
      }
    }
  }
  return problems;
}

/** Authenticated pages: exactly one primary-nav link is marked as the current page; returns its text. */
export function checkNavCurrent(root: ParentNode = document): { problems: string[]; current: string | null } {
  const nav = root.querySelector('nav[aria-label="Điều hướng chính"]');
  if (nav === null) return { problems: ['primary navigation not found'], current: null };
  const current = Array.from(nav.querySelectorAll('a[aria-current="page"]'));
  const problems = current.length === 1 ? [] : [`expected exactly one aria-current="page" nav link, found ${current.length}`];
  return { problems, current: current[0] === undefined ? null : textOf(current[0]) };
}
