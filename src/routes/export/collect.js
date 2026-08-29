/**
 * Three of the app's surfaces, taken off the map as standalone markup and the
 * styles they actually use.
 *
 * The reason this is more than `outerHTML` is that a surface's appearance
 * arrives from four places at once, and only one of them travels on its own:
 *
 *   1. the component's own scoped rules      — travel, because Svelte hashed them
 *   2. the base rules in app.css             — do not: `button`, `input`, `*`
 *   3. the custom properties on `:root`      — do not: every colour and material
 *   4. what the document inherits into them  — does not: the font, the tracking
 *
 * So all four are collected and re-homed under one host selector. That is what
 * makes the output droppable into a page that knows nothing about this app
 * without either half leaking: nothing here can match outside the host, and
 * nothing outside the host reaches in far enough to matter.
 *
 * A fifth thing is deliberately NOT collected: where each surface sits. These
 * are floating chrome — pinned to a viewport, anchored to a marker, slid up from
 * the bottom edge — and off the map there is nothing to float over. Placement is
 * the consumer's, so the export normalises it away and reports each surface's
 * size instead. See `normalisation`.
 *
 * The DOM walk here is thin. Every decision it makes is one of the pure
 * functions above it, and those are where the tests are (collect.test.js).
 */

/** What every emitted selector hangs off. */
export const HOST = '.eater-cards';

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

/** Split on a delimiter that is not inside parens, brackets or a string. Used
 *  for both of the two lists CSS hands over as one string — a selector list on
 *  its commas, and a declaration list on its semicolons — because `:is(a, b)`,
 *  `[title="x, y"]` and `url(data:…;base64,…)` each break a naive split, and
 *  they break it silently. */
export function splitTopLevel(text, delimiter) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (quote) {
      if (character === quote && text[i - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (character === delimiter && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

export const splitSelectorList = (selector) => splitTopLevel(selector, ',');

/**
 * A rule's declarations, taken from its `cssText` rather than by index.
 *
 * By index is the obvious way and it is wrong here: a shorthand carrying a
 * `var()` — `padding: var(--x) 14px` — is stored unresolved, so CSSOM answers
 * the empty string for every longhand it should have set and the declaration
 * vanishes from the export without anything saying so. `cssText` round-trips
 * whatever the rule actually holds.
 */
export const declarationsIn = (cssText) => splitTopLevel(cssText, ';');

/** A rule that means "the page" rather than an element on it. */
const DOCUMENT_SELECTOR = /^(?::root|html|body)\b/;

export function isDocumentSelector(part) {
  return DOCUMENT_SELECTOR.test(part);
}

/**
 * One selector, re-homed under `host`.
 *
 * `*` is both the host and everything under it: `* { box-sizing: border-box }`
 * is a rule these components are drawn under, and losing it on the surface's own
 * root would change its box model and nothing else — which is the kind of
 * difference that reads as a bad export rather than as a missing rule.
 */
export function prefixSelector(host, part) {
  if (part === '*') return `${host}, ${host} *`;
  return `${host} ${part}`;
}

/** State pseudo-classes match nothing on a surface nobody is touching. Dropping
 *  the rules they gate would drop styles these components genuinely have, so the
 *  selector is TESTED without them and KEPT with them. */
/* Longest alternative first. `focus` before `focus-visible` matches the first
 * six letters of it and leaves `-visible` behind as a selector, and `\b` between
 * a letter and a hyphen does not stop it. */
const STATE_PSEUDO = /:(?:focus-visible|focus-within|focus|hover|active|visited|target|checked|enabled|disabled)\b/g;

export function probeSelector(part) {
  return part.replace(STATE_PSEUDO, '').trim() || '*';
}

/* -------------------------------------------------------------------------- */
/* Values that depend on a window                                              */
/* -------------------------------------------------------------------------- */

const VIEWPORT_UNIT = /(^|[^\w.-])(-?\d*\.?\d+)(dvw|dvh|svw|svh|lvw|lvh|vmin|vmax|vw|vh)\b/gi;
const SAFE_AREA = /env\(\s*safe-area-inset-[a-z]+\s*(?:,[^()]*)?\)/gi;

/**
 * A declaration with every window-dependent length resolved against the window
 * the export was taken in.
 *
 * Same decision as resolving `@media` at export time, for the same reason and
 * one step further in: a card vendored into another page would answer `4vw`
 * about THAT page's window, so the restaurant's name would resize with a window
 * that has nothing to do with the app. A Card is a picture of the app at a
 * stated size, and this is what makes that true of its insides as well as its
 * outside.
 *
 * `env(safe-area-inset-…)` goes the same way. It is zero in every window that is
 * not a notched phone held a particular way up, which is what it resolves to
 * here — and carrying it would let a reader's phone add padding to a card drawn
 * for a different device.
 */
export function freezeToViewport(value, { width, height }) {
  return String(value)
    .replace(SAFE_AREA, '0px')
    .replace(VIEWPORT_UNIT, (whole, before, amount, unit) => {
      const lower = unit.toLowerCase();
      const basis = lower.endsWith('w')
        ? width
        : lower.endsWith('h')
          ? height
          : lower === 'vmin'
            ? Math.min(width, height)
            : Math.max(width, height);
      return `${before}${Number(((Number(amount) / 100) * basis).toFixed(3))}px`;
    });
}

/* -------------------------------------------------------------------------- */
/* Custom properties                                                           */
/* -------------------------------------------------------------------------- */

/** Every `var(--name)` mentioned in a chunk of CSS text. */
export function varsIn(text) {
  const found = new Set();
  for (const [, name] of String(text).matchAll(/var\(\s*(--[\w-]+)/g)) found.add(name);
  return found;
}

/**
 * The custom properties `used` actually reaches, out of everything `declared`.
 *
 * Followed transitively, because a token's value names other tokens
 * (`--glass-rim` is built from nothing, `--glass-filter-heavy` from three
 * functions) and one hop would ship a value whose own `var()` resolves to
 * nothing. Insertion order is the declared order, so the emitted block reads
 * the way the source does.
 */
export function closeOverVars(used, declared) {
  const wanted = new Set();
  const queue = [...used];
  while (queue.length) {
    const name = queue.pop();
    if (wanted.has(name) || !declared.has(name)) continue;
    wanted.add(name);
    for (const next of varsIn(declared.get(name))) queue.push(next);
  }
  const out = new Map();
  for (const [name, value] of declared) if (wanted.has(name)) out.set(name, value);
  return out;
}

/* -------------------------------------------------------------------------- */
/* What the surfaces inherit from the app's document                           */
/* -------------------------------------------------------------------------- */

/**
 * The inherited properties that decide how these surfaces read, resolved off the
 * app's own `body` rather than restated here.
 *
 * `html, body` is not re-homed onto the host wholesale, and the reason is that
 * most of what it declares is about being a page — `overflow: hidden`, a
 * background, a min-height — none of which a standalone card should carry. What
 * it does carry that matters is the font stack and the tracking, and reading
 * those computed is exact where hand-picking a rule's declarations would be a
 * guess that goes stale.
 */
export const INHERITED = [
  'color',
  'color-scheme',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant-numeric',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-transform',
  'direction',
  '-webkit-font-smoothing',
  '-moz-osx-font-smoothing',
];

/* -------------------------------------------------------------------------- */
/* Emitting                                                                    */
/* -------------------------------------------------------------------------- */

function block(selector, declarations) {
  if (!declarations.length) return '';
  return `${selector} {\n${declarations.map((one) => `  ${one};`).join('\n')}\n}\n`;
}

/**
 * The one part of the output that is the exporter's own opinion rather than the
 * app's, and it is here rather than in the consumer because it is a fact about
 * these surfaces: each is chrome floating over a live map, and there is no map.
 *
 * `!important`, deliberately. Svelte's scoping adds a class to every compound,
 * so the app's own rule for a surface outweighs anything an exporter can write
 * in front of it without either matching the hash — which would rot on the next
 * build of this repo — or racing it on specificity, which is worse because it
 * would only sometimes lose. Five declarations, each undoing one thing the app
 * says about where a surface hangs, is small enough to be read.
 *
 * The size is the size the app drew it at, handed over as a custom property so
 * the consumer can compose with it rather than being told.
 */
export function normalisation(cards) {
  let css = '/* Off the map: each surface is a block of the size the app drew it\n';
  css += '   at, and nothing here says where it goes. */\n';
  css += block(
    HOST,
    cards.flatMap((card) => [
      `--eater-card-${card.name}-width: ${card.width}px`,
      `--eater-card-${card.name}-height: ${card.height}px`,
    ]),
  );
  for (const card of cards) {
    css += block(`${HOST} [data-eater-card='${card.name}']`, [
      'position: relative !important',
      'inset: auto !important',
      'transform: none !important',
      'margin: 0 !important',
      `width: var(--eater-card-${card.name}-width) !important`,
      `height: var(--eater-card-${card.name}-height) !important`,
    ]);
  }
  return css;
}

/* -------------------------------------------------------------------------- */
/* The walk                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every style rule the document holds, with `@media` and `@supports` resolved
 * AT EXPORT TIME rather than carried.
 *
 * That is a decision and not a shortcut. These components' queries are about the
 * viewport the app is running in — `max-width: 820px` is what turns the details
 * panel into a bottom sheet — and a card vendored into another page would answer
 * that query about THAT page's window, which has nothing to do with the app.
 * Freezing them against the export viewport is what makes the output a picture
 * of the app at a stated size instead of a thing that reshapes itself somewhere
 * it cannot see.
 *
 * There are no `@keyframes` to carry: nothing in these three surfaces animates
 * (app.css mentions `animation` only to switch it off under reduced motion). If
 * that changes, this is where the collection would go.
 */
function eachStyleRule(rules, view, visit) {
  for (const rule of rules) {
    if (rule.selectorText) {
      visit(rule);
      continue;
    }
    if (rule.media && rule.cssRules) {
      if (view.matchMedia(rule.conditionText ?? rule.media.mediaText).matches) {
        eachStyleRule(rule.cssRules, view, visit);
      }
      continue;
    }
    if (rule.conditionText && rule.cssRules) {
      // @supports — the only other conditional group these stylesheets use.
      if (view.CSS?.supports?.(rule.conditionText)) eachStyleRule(rule.cssRules, view, visit);
    }
  }
}

/** Every element inside a stage, the surface's own root included. */
function elementsOf(root) {
  return [root, ...root.querySelectorAll('*')];
}

/**
 * The three things a live subtree holds that `cloneNode` does not carry out of
 * the app with it.
 *
 * A typed value lives on the DOM property and not on the attribute, so a search
 * bar exported mid-search comes out showing its placeholder AND its result count
 * at once — a card that is visibly of no moment the app ever had. Svelte's
 * `<!---->` anchors are runtime bookkeeping for a component that is not coming
 * with them. And the authored comments in the app's markup are notes to whoever
 * maintains that repository, not to this one.
 */
function settle(source, clone) {
  const live = source.querySelectorAll('input, textarea');
  const copies = clone.querySelectorAll('input, textarea');
  for (let i = 0; i < live.length; i += 1) {
    const field = live[i];
    const copy = copies[i];
    if (!copy) continue;
    if (field.type === 'checkbox' || field.type === 'radio') copy.toggleAttribute('checked', field.checked);
    else if (field.tagName === 'TEXTAREA') copy.textContent = field.value;
    else copy.setAttribute('value', field.value);
  }
  const strip = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) child.remove();
      else if (child.nodeType === 1) strip(child);
    }
  };
  strip(clone);
}

/**
 * Collect the three cards.
 *
 * @param {{ name: string, root: Element }[]} surfaces  the surface roots, in order
 * @param {Document} document
 * @param {Window} view
 */
export function collect(surfaces, document, view) {
  const reachable = surfaces.map(({ name, root }) => ({ name, root, elements: elementsOf(root) }));
  const everyElement = reachable.flatMap((one) => one.elements);
  const viewport = { width: view.innerWidth, height: view.innerHeight };

  /** Custom properties the document declares, in declared order. */
  const declaredVars = new Map();
  /** The rules that reach into a surface, in cascade order. */
  const kept = [];

  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin; nothing of ours is
    }
    eachStyleRule(rules, view, (rule) => {
      const parts = splitSelectorList(rule.selectorText);
      const documentParts = parts.filter((part) => isDocumentSelector(part));
      if (documentParts.length) {
        // A document-level rule contributes its custom properties and nothing
        // else — the rest of what it says is about being a page.
        for (let i = 0; i < rule.style.length; i += 1) {
          const property = rule.style[i];
          if (property.startsWith('--')) {
            declaredVars.set(property, freezeToViewport(rule.style.getPropertyValue(property).trim(), viewport));
          }
        }
      }
      const matched = parts.filter(
        (part) =>
          !isDocumentSelector(part) &&
          everyElement.some((element) => {
            try {
              return element.matches(probeSelector(part));
            } catch {
              return false;
            }
          }),
      );
      if (matched.length) kept.push({ parts: matched, body: freezeToViewport(rule.style.cssText, viewport) });
    });
  }

  const inherited = view.getComputedStyle(document.body);
  const context = INHERITED.map((property) => `${property}: ${inherited.getPropertyValue(property)}`).filter(
    (one) => !one.endsWith(': '),
  );

  const usedVars = varsIn(kept.map((one) => one.body).join(';') + ';' + context.join(';'));
  const vars = closeOverVars(usedVars, declaredVars);

  const cards = reachable.map(({ name, root }) => {
    const box = root.getBoundingClientRect();
    const clone = root.cloneNode(true);
    settle(root, clone);
    // The root's inline style is where the app wrote this surface's placement —
    // the popup's anchor, in screen pixels, against a map that is not here.
    // Everything below it (a scrollbar thumb's travel, the description line
    // clamp) is state and stays.
    clone.removeAttribute('style');
    clone.setAttribute('data-eater-card', name);
    return {
      name,
      width: Math.round(box.width),
      height: Math.round(box.height),
      html: clone.outerHTML,
    };
  });

  let css = block(HOST, context);
  css += block(HOST, [...vars].map(([property, value]) => `${property}: ${value}`));
  for (const rule of kept) {
    css += block(rule.parts.map((part) => prefixSelector(HOST, part)).join(',\n'), declarationsIn(rule.body));
  }
  css += normalisation(cards);

  return { host: HOST.replace(/^\./, ''), cards, css };
}
