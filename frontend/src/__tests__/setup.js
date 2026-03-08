/**
 * Vitest test setup — runs before each test file.
 * Ensures browser APIs that jsdom may not fully implement are available.
 */
import '@testing-library/jest-dom';

// Ensure localStorage is available and functional in all test environments.
// jsdom provides localStorage, but some environments require explicit setup.
if (typeof localStorage === 'undefined' || localStorage === null) {
    const localStorageMock = (() => {
        let store = {};
        return {
            getItem: (key) => store[key] ?? null,
            setItem: (key, value) => { store[key] = String(value); },
            removeItem: (key) => { delete store[key]; },
            clear: () => { store = {}; },
        };
    })();
    Object.defineProperty(global, 'localStorage', { value: localStorageMock });
}
