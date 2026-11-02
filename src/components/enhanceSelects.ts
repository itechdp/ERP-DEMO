// Gives every ordinary <select> in the app the same drop-down list (rounded, app colours, tick on the chosen line) instead of the
// browser's own grey/blue list. It works on whatever <select> is on the page — forms, filters, modals — so no page has to change:
// the real <select> stays in charge (value, onChange, disabled, required …); this only draws the list that opens from it.
// Not used on touch screens (the phone's own picker is better there), for multi-selects, or for <select data-native>.

let started = false;
let menu: HTMLDivElement | null = null;
let owner: HTMLSelectElement | null = null;

const coarse = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
const eligible = (el: EventTarget | null): el is HTMLSelectElement =>
  el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled && !el.hasAttribute('data-native');

function close(refocus = false) {
  menu?.remove();
  menu = null;
  if (owner && refocus) owner.focus();
  owner = null;
}

function choose(select: HTMLSelectElement, index: number) {
  if (select.selectedIndex !== index) {
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  close(true);
}

function open(select: HTMLSelectElement) {
  close();
  owner = select;
  const m = document.createElement('div');
  m.className = 'dd-menu';
  m.setAttribute('role', 'listbox');
  const rows: HTMLElement[] = [];

  const addOption = (o: HTMLOptionElement, grouped: boolean) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dd-item' + (o.selected ? ' on' : '') + (grouped ? ' grouped' : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(o.selected));
    b.disabled = o.disabled;
    const t = document.createElement('span');
    t.textContent = o.text;
    b.appendChild(t);
    if (o.selected) {
      const tick = document.createElement('span');
      tick.className = 'dd-tick';
      tick.textContent = '✓';
      b.appendChild(tick);
    }
    b.addEventListener('click', () => choose(select, o.index));
    m.appendChild(b);
    rows.push(b);
  };
  for (const child of Array.from(select.children)) {
    if (child instanceof HTMLOptGroupElement) {
      const h = document.createElement('div');
      h.className = 'dd-group';
      h.textContent = child.label;
      m.appendChild(h);
      for (const o of Array.from(child.children) as HTMLOptionElement[]) addOption(o, true);
    } else if (child instanceof HTMLOptionElement) addOption(child, false);
  }

  document.body.appendChild(m);
  menu = m;
  const r = select.getBoundingClientRect();
  m.style.minWidth = `${Math.max(r.width, 160)}px`;
  const h = m.offsetHeight;
  const below = window.innerHeight - r.bottom - 12;
  const up = below < Math.min(h, 220) && r.top > below;
  m.style.maxHeight = `${Math.max(140, Math.min(320, up ? r.top - 12 : below))}px`;
  m.style.left = `${Math.min(r.left, window.innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = up ? `${r.top - Math.min(m.offsetHeight, r.top - 12) - 6}px` : `${r.bottom + 6}px`;
  rows.find((x) => x.classList.contains('on'))?.scrollIntoView({ block: 'nearest' });
  (rows.find((x) => x.classList.contains('on')) ?? rows.find((x) => !(x as HTMLButtonElement).disabled))?.focus();
}

export function enhanceSelects() {
  if (started || typeof document === 'undefined') return;
  started = true;

  document.addEventListener(
    'mousedown',
    (e) => {
      const t = e.target;
      if (menu && t instanceof Node && menu.contains(t)) return;
      if (eligible(t) && !coarse() && e.button === 0) {
        e.preventDefault(); // no native list
        if (owner === t) return close();
        t.focus();
        open(t);
        return;
      }
      close();
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (menu) {
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('.dd-item:not(:disabled)'));
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        } else if (e.key === 'Tab') close();
        return;
      }
      const t = e.target;
      if (eligible(t) && !coarse() && (e.key === ' ' || e.key === 'Enter' || (e.altKey && e.key === 'ArrowDown'))) {
        e.preventDefault();
        open(t);
      }
    },
    true,
  );

  window.addEventListener('resize', () => close());
  window.addEventListener('blur', () => close());
  // a scroll of the page moves the select away from the list; scrolling inside the list itself is fine
  document.addEventListener('scroll', (e) => !(menu && e.target instanceof Node && menu.contains(e.target)) && close(), true);
}
