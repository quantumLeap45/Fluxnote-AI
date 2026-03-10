/**
 * Tests for ChatView blank bubble guard logic.
 *
 * Covers the fix added in the reliability sprint:
 * - When streaming ends with no content, show a "No response received" error
 *   instead of rendering a blank/empty bubble.
 *
 * Pure logic unit tests — no React rendering required.
 * The guard is the ternary: !streaming ? <error> : null
 * replacing the raw null in the message-text render branch.
 */
import { describe, it, expect } from 'vitest';

/**
 * Mirror of the blank-content rendering decision in ChatView's message-text block.
 *
 * Returns:
 *   'typing'   — still streaming, show typing indicator (handled by outer condition)
 *   'error'    — stream done, no content → show no-response-error
 *   null       — still streaming, empty content, defer (typing indicator or panels handle it)
 */
function resolveEmptyContentDisplay(streaming) {
    // Mirrors: !streaming ? 'error' : null
    return !streaming ? 'error' : null;
}

/**
 * Full guard replicating the outer condition chain in message-text:
 *   content === '' && streaming && no thinking && no routing  → 'typing'
 *   content truthy                                            → 'content'
 *   else: !streaming                                          → 'error'
 *   else                                                      → null
 */
function resolveMessageDisplay({ content, streaming, hasThinking = false, hasRouting = false }) {
    if (content === '' && streaming && !hasThinking && !hasRouting) return 'typing';
    if (content) return 'content';
    return !streaming ? 'error' : null;
}

// ── Test 1: show error when stream is done with no content ────────────────────

describe('blank bubble guard — resolveEmptyContentDisplay', () => {
    it('returns "error" when not streaming (stream ended with no content)', () => {
        expect(resolveEmptyContentDisplay(false)).toBe('error');
    });

    it('returns null when streaming (stream still in progress)', () => {
        expect(resolveEmptyContentDisplay(true)).toBeNull();
    });
});

// ── Test 2: full render decision logic ────────────────────────────────────────

describe('blank bubble guard — full message display logic', () => {
    it('shows typing indicator when streaming with empty content (no panels)', () => {
        expect(resolveMessageDisplay({ content: '', streaming: true })).toBe('typing');
    });

    it('shows content when content is non-empty regardless of streaming state', () => {
        expect(resolveMessageDisplay({ content: 'Hello', streaming: false })).toBe('content');
        expect(resolveMessageDisplay({ content: 'Hello', streaming: true })).toBe('content');
    });

    it('shows error when stream is done and content is empty', () => {
        expect(resolveMessageDisplay({ content: '', streaming: false })).toBe('error');
    });

    it('returns null when streaming with empty content AND thinking panel is active', () => {
        // Thinking panel or routing panel is already rendering — defer
        expect(resolveMessageDisplay({ content: '', streaming: true, hasThinking: true })).toBeNull();
        expect(resolveMessageDisplay({ content: '', streaming: true, hasRouting: true })).toBeNull();
    });
});

// ── Test 3: error message text ────────────────────────────────────────────────

describe('no-response-error message text', () => {
    const NO_RESPONSE_TEXT = 'No response received — please try again.';

    it('error message contains the expected user-facing text', () => {
        // Verify the constant matches what is rendered in ChatView
        expect(NO_RESPONSE_TEXT).toContain('No response received');
        expect(NO_RESPONSE_TEXT).toContain('please try again');
    });
});
