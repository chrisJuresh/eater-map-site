import { describe, expect, it } from 'vitest';
import {
  HOST,
  closeOverVars,
  declarationsIn,
  freezeToViewport,
  isDocumentSelector,
  normalisation,
  prefixSelector,
  probeSelector,
  splitSelectorList,
  splitTopLevel,
  varsIn,
} from './collect.js';

describe('splitTopLevel', () => {
  it('splits a plain list', () => {
    expect(splitSelectorList('.a, .b , .c')).toEqual(['.a', '.b', '.c']);
  });

  it('holds a comma inside parens', () => {
    expect(splitSelectorList(':is(.a, .b) .c, .d')).toEqual([':is(.a, .b) .c', '.d']);
  });

  it('holds a comma inside an attribute string', () => {
    expect(splitSelectorList('[title="x, y"], .b')).toEqual(['[title="x, y"]', '.b']);
  });

  it('holds a semicolon inside a url()', () => {
    expect(declarationsIn('background: url(data:image/svg+xml;base64,AAA); color: red')).toEqual([
      'background: url(data:image/svg+xml;base64,AAA)',
      'color: red',
    ]);
  });

  it('drops the empty tail a trailing delimiter leaves', () => {
    expect(declarationsIn('color: red;')).toEqual(['color: red']);
  });

  it('leaves a value that is only a delimiter alone', () => {
    expect(splitTopLevel('', ',')).toEqual([]);
  });

  it('closes a string whose last character is an ESCAPED backslash', () => {
    // "is the previous character a backslash" reads `"a\\"` as still open and
    // swallows everything after it into one part.
    expect(splitSelectorList('[title="a\\\\"], .b')).toEqual(['[title="a\\\\"]', '.b']);
    // …while a genuinely escaped quote still holds the string open.
    expect(splitSelectorList('[title="a\\",b"], .c')).toEqual(['[title="a\\",b"]', '.c']);
  });
});

describe('isDocumentSelector', () => {
  it('names the three ways a rule says "the page"', () => {
    for (const part of [':root', 'html', 'body', ':root[data-x]', 'body.dark']) {
      expect(isDocumentSelector(part)).toBe(true);
    }
  });

  it('does not catch a class that merely starts with one of them', () => {
    for (const part of ['.bodyguard', '.html-thing', '.rooted']) {
      expect(isDocumentSelector(part)).toBe(false);
    }
  });

  it('does not catch a rule that is merely ANCHORED at the page', () => {
    // `body.dark .panel` is a rule about .panel. Read as a document rule,
    // everything it says would be thrown away and only its custom properties
    // kept — silently, and only once this app grew a selector shaped like that.
    for (const part of ['body.dark .panel', ':root .a', 'html > body .b']) {
      expect(isDocumentSelector(part)).toBe(false);
    }
  });
});

describe('prefixSelector', () => {
  it('makes a selector a descendant of the host', () => {
    expect(prefixSelector('.h', '.topbar .search')).toBe('.h .topbar .search');
  });

  it('makes the universal selector the host as well as everything under it', () => {
    // `* { box-sizing: border-box }` is a rule these surfaces are drawn under,
    // and losing it on the surface's own root changes its box model alone —
    // which reads as a bad export rather than as a missing rule.
    expect(prefixSelector('.h', '*')).toBe('.h, .h *');
  });
});

describe('probeSelector', () => {
  it('drops state pseudo-classes so a rule nobody is touching is still found', () => {
    expect(probeSelector('button:hover')).toBe('button');
    expect(probeSelector('.a:focus-visible .b')).toBe('.a .b');
  });

  it('never returns nothing', () => {
    expect(probeSelector(':focus-visible')).toBe('*');
  });

  it('leaves a structural pseudo-class alone', () => {
    expect(probeSelector('li:first-child')).toBe('li:first-child');
  });

  it('drops pseudo-ELEMENTS, which matches() throws on rather than declines', () => {
    // This is the one that actually cost rules. A thrown selector is
    // indistinguishable from one that matched nothing, so `·` between the
    // details panel's meta items and the rule hiding the descriptions'
    // scrollbar were both dropped from the first export with nothing said.
    expect(probeSelector('.meta-row span + span::before')).toBe('.meta-row span + span');
    expect(probeSelector('.descriptions::-webkit-scrollbar')).toBe('.descriptions');
    expect(probeSelector('.a:after')).toBe('.a');
    expect(probeSelector('.a::first-line')).toBe('.a');
  });

  it('takes a functional pseudo-element’s argument with it', () => {
    expect(probeSelector('.a::part(handle)')).toBe('.a');
    expect(probeSelector('.a::slotted(span)')).toBe('.a');
  });
});

describe('freezeToViewport', () => {
  const viewport = { width: 390, height: 844 };

  it('resolves every viewport unit against the window the export was taken in', () => {
    expect(freezeToViewport('font-size: clamp(24px, 4vw, 32px)', viewport)).toBe('font-size: clamp(24px, 15.6px, 32px)');
    expect(freezeToViewport('max-height: min(56dvh, 470px)', viewport)).toBe('max-height: min(472.64px, 470px)');
    expect(freezeToViewport('width: 50vmin', viewport)).toBe('width: 195px');
    expect(freezeToViewport('width: 50vmax', viewport)).toBe('width: 422px');
  });

  it('resolves a negative amount and one written without a leading zero', () => {
    expect(freezeToViewport('margin: -10vw .5vh', viewport)).toBe('margin: -39px 4.22px');
  });

  it('leaves the safe area at nothing, which is what every window that is not a notched phone has', () => {
    expect(freezeToViewport('padding: max(8px, env(safe-area-inset-bottom))', viewport)).toBe('padding: max(8px, 0px)');
    expect(freezeToViewport('top: env(safe-area-inset-top, 12px)', viewport)).toBe('top: 0px');
  });

  it('does not touch a length that is text rather than a length', () => {
    expect(freezeToViewport('content: "50vw"', viewport)).toBe('content: "50vw"');
    expect(freezeToViewport("content: '4vh'; width: 4vh", viewport)).toBe("content: '4vh'; width: 33.76px");
  });

  it('does not touch a length it cannot resolve, or a word that merely ends in one', () => {
    expect(freezeToViewport('width: 100%; font-family: Chivo', viewport)).toBe('width: 100%; font-family: Chivo');
    expect(freezeToViewport('--rem-2vh-name: 3px', viewport)).toBe('--rem-2vh-name: 3px');
  });
});

describe('varsIn', () => {
  it('finds every custom property a value names', () => {
    expect([...varsIn('box-shadow: var(--glass-rim), var( --elev-1 )')]).toEqual(['--glass-rim', '--elev-1']);
  });

  it('finds none where there are none', () => {
    expect([...varsIn('color: red')]).toEqual([]);
  });
});

describe('closeOverVars', () => {
  const declared = new Map([
    ['--a', 'var(--b) 2px'],
    ['--b', 'var(--c)'],
    ['--c', 'red'],
    ['--unused', 'blue'],
  ]);

  it('follows one property to another until nothing new turns up', () => {
    expect([...closeOverVars(new Set(['--a']), declared)]).toEqual([
      ['--a', 'var(--b) 2px'],
      ['--b', 'var(--c)'],
      ['--c', 'red'],
    ]);
  });

  it('leaves out what nothing reaches', () => {
    expect(closeOverVars(new Set(['--c']), declared).has('--unused')).toBe(false);
  });

  it('keeps the declared order rather than the order they were reached in', () => {
    expect([...closeOverVars(new Set(['--c', '--a']), declared).keys()]).toEqual(['--a', '--b', '--c']);
  });

  it('ignores a name nothing declares', () => {
    expect(closeOverVars(new Set(['--missing']), declared).size).toBe(0);
  });

  it('terminates on a cycle', () => {
    const cyclic = new Map([
      ['--x', 'var(--y)'],
      ['--y', 'var(--x)'],
    ]);
    expect([...closeOverVars(new Set(['--x']), cyclic).keys()]).toEqual(['--x', '--y']);
  });
});

describe('normalisation', () => {
  const css = normalisation([
    { name: 'search', width: 366, height: 48 },
    { name: 'lines', width: 218, height: 132 },
  ]);

  it('hands the measured size over as a custom property rather than writing it in', () => {
    expect(css).toContain('--eater-card-search-width: 366px');
    expect(css).toContain("width: var(--eater-card-search-width) !important");
  });

  it('undoes every way a surface says where it floats', () => {
    for (const property of ['position', 'inset', 'transform', 'margin']) {
      expect(css).toContain(`${property}: `);
    }
  });

  it('reaches only inside the host', () => {
    for (const line of css.split('\n')) {
      if (line.includes('{')) expect(line.startsWith(HOST)).toBe(true);
    }
  });
});
