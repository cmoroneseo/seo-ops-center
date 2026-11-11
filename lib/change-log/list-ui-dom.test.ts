import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

/** A document has to exist before the change log view loads, or the popover cannot open in tests. */
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/change-log-example',
    pretendToBeVisual: true,
});

globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    enumerable: true,
    writable: true,
});
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.FocusEvent = dom.window.FocusEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.PointerEvent = dom.window.PointerEvent;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.ResizeObserver ??= class {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
};

const elementPrototype = dom.window.HTMLElement.prototype as unknown as {
    attachEvent?: () => void;
    detachEvent?: () => void;
    hasPointerCapture?: () => boolean;
    setPointerCapture?: () => void;
    releasePointerCapture?: () => void;
    scrollIntoView?: () => void;
};
elementPrototype.attachEvent ??= () => undefined;
elementPrototype.detachEvent ??= () => undefined;
elementPrototype.hasPointerCapture ??= () => false;
elementPrototype.setPointerCapture ??= () => undefined;
elementPrototype.releasePointerCapture ??= () => undefined;
elementPrototype.scrollIntoView ??= () => undefined;

export { dom };

test('the change log list test has a document before the view loads', () => {
    assert.equal(typeof document, 'object');
    assert.equal(typeof getComputedStyle, 'function');
    assert.equal(typeof NodeFilter, 'function');
});
