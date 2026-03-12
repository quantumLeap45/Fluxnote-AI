/**
 * Tests for CardCreationPanel failure-locking behaviour.
 *
 * Pre-launch reliability sprint:
 * - After extraction fails, Create Card button must be permanently disabled
 * - Error message must direct user to Dashboard for retry
 * - onCardCreated must NOT be called on failure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../api', () => ({
    uploadToStorage:      vi.fn(),
    processStorageFile:   vi.fn(),
    uploadFile:           vi.fn().mockRejectedValue(new Error('Extraction failed — malformed response')),
    createAssignment:     vi.fn(),
    createAssignmentMulti: vi.fn(),
}));

// CardCreationPanel reads VITE_SUPABASE_URL from import.meta.env at module load.
// Vitest exposes import.meta.env as an empty object by default so useStorage = false
// → uploadFile path is taken, which we mock to reject above.

import CardCreationPanel from '../components/CardCreationPanel';

describe('CardCreationPanel — failure locking', () => {
    const onCardCreated = vi.fn();
    const onCancel = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function renderAndFail() {
        render(
            <CardCreationPanel
                sessionId="test-session"
                onCardCreated={onCardCreated}
                onCancel={onCancel}
            />
        );

        // Add a file via the hidden file input
        const input = document.querySelector('input[type="file"]');
        const file = new File(['pdf content'], 'assignment.pdf', { type: 'application/pdf' });
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        fireEvent.change(input, { target: { files: [file] } });

        // Click Create Card
        const btn = screen.getByText('Create Card');
        fireEvent.click(btn);

        // Wait for the error to appear
        await waitFor(() => {
            expect(screen.getByText(/Extraction failed/i)).toBeInTheDocument();
        });
    }

    it('disables the Create Card button permanently after failure', async () => {
        await renderAndFail();
        // Button should now show "Failed" and be disabled
        const failedBtn = screen.getByText('Failed');
        expect(failedBtn).toBeDisabled();
    });

    it('shows guidance to use Dashboard after failure', async () => {
        await renderAndFail();
        expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    });

    it('does not call onCardCreated on failure', async () => {
        await renderAndFail();
        expect(onCardCreated).not.toHaveBeenCalled();
    });
});
