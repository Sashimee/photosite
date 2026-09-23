import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

Element.prototype.hasPointerCapture = (): boolean => false;
Element.prototype.setPointerCapture = (): void => undefined;
Element.prototype.releasePointerCapture = (): void => undefined;
Element.prototype.scrollIntoView = (): void => undefined;

class ResizeObserverStub {
  observe = (): void => undefined;
  unobserve = (): void => undefined;
  disconnect = (): void => undefined;
}

window.ResizeObserver = ResizeObserverStub;

// jsdom 30.1's removal focus-fixup (https://github.com/jsdom/jsdom/commit/94301581)
// leaves `document` itself as the "last focused element" once the previously
// focused node is removed. The next `.focus()` call then redirects that
// Document target to its `defaultView`, dispatching a "blur" on `window`
// with `relatedTarget` set to the element about to gain focus - a signature
// no real browser produces for an actual window blur.
window.addEventListener(
  'blur',
  (event) => {
    if (event instanceof FocusEvent && event.relatedTarget !== null) {
      event.stopImmediatePropagation();
    }
  },
  { capture: true },
);
