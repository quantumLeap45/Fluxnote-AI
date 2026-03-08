/**
 * Vitest test setup — runs before each test file.
 * Unconditionally replaces jsdom's localStorage with a reliable mock
 * to avoid inconsistencies across jsdom versions.
 */
import '@testing-library/jest-dom';

const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; },
        get length() { return Object.keys(store).length; },
        key: (n) => Object.keys(store)[n] ?? null,
    };
})();

Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
});
