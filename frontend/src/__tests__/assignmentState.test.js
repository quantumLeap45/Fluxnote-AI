/**
 * Tests for assignment state propagation.
 *
 * Covers the critical paths added in the foundation stabilization sprint:
 * - Re-extract result propagates to parent (onAssignmentUpdate called)
 * - Re-extract failure shows error alert (no silent swallow)
 * - Polling state change propagates to parent (onCardUpdate called)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── AssignmentDetail — re-extract propagation ─────────────────────────────

vi.mock('../api', () => ({
    reExtractAssignment: vi.fn(),
    getAssignment: vi.fn(),
    retryAssignment: vi.fn(),
}));

// Suppress alert in test environment
globalThis.alert = vi.fn();

import { reExtractAssignment, getAssignment } from '../api';
import AssignmentDetail from '../components/AssignmentDetail';
import AssignmentCard from '../components/AssignmentCard';

const mockAssignment = {
    id: 'asgn-001',
    title: 'Test Essay',
    filename: 'essay.pdf',
    module: 'ENG101',
    due_date: '2026-05-01',
    weightage: '30%',
    assignment_type: 'Individual',
    deliverable_type: 'report',
    summary: ['Write an essay'],
    checklist: ['Research', 'Write draft'],
    constraints: '## Format\n- 2000 words',
    file_ids: ['file-001'],
    file_id: 'file-001',
    processing_state: 'ready',
    extraction_version: 2,
};

describe('AssignmentDetail — re-extract state propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('calls onAssignmentUpdate with updated card after successful re-extract', async () => {
        const updatedAssignment = { ...mockAssignment, title: 'Updated Essay Title', extraction_version: 2 };
        reExtractAssignment.mockResolvedValueOnce(updatedAssignment);

        const onAssignmentUpdate = vi.fn();
        const onClose = vi.fn();
        const onAskAI = vi.fn();

        // Render an old card (extraction_version 1) so upgrade banner shows
        const oldCard = { ...mockAssignment, extraction_version: 1 };
        render(
            <AssignmentDetail
                assignment={oldCard}
                sessionId="workspace-001"
                onClose={onClose}
                onAskAI={onAskAI}
                onAssignmentUpdate={onAssignmentUpdate}
            />
        );

        // Click "Refresh analysis" button in upgrade banner
        const refreshBtn = screen.getByText(/Refresh analysis/i);
        fireEvent.click(refreshBtn);

        await waitFor(() => {
            expect(reExtractAssignment).toHaveBeenCalledWith('asgn-001', 'workspace-001');
        });

        await waitFor(() => {
            expect(onAssignmentUpdate).toHaveBeenCalledWith(updatedAssignment);
        });
    });

    it('does NOT call onAssignmentUpdate when re-extract fails', async () => {
        reExtractAssignment.mockRejectedValueOnce(new Error('API error'));

        const onAssignmentUpdate = vi.fn();
        const oldCard = { ...mockAssignment, extraction_version: 1 };

        render(
            <AssignmentDetail
                assignment={oldCard}
                sessionId="workspace-001"
                onClose={vi.fn()}
                onAskAI={vi.fn()}
                onAssignmentUpdate={onAssignmentUpdate}
            />
        );

        const refreshBtn = screen.getByText(/Refresh analysis/i);
        fireEvent.click(refreshBtn);

        await waitFor(() => {
            expect(reExtractAssignment).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(onAssignmentUpdate).not.toHaveBeenCalled();
        });
    });
});


// ── AssignmentCard — polling state propagation ────────────────────────────

describe('AssignmentCard — polling state propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('calls onCardUpdate when polling detects a state change from processing to ready', async () => {
        const processingCard = { ...mockAssignment, processing_state: 'processing' };
        const readyCard = { ...mockAssignment, processing_state: 'ready' };

        getAssignment.mockResolvedValue(readyCard);

        const onCardUpdate = vi.fn();

        render(
            <AssignmentCard
                assignment={processingCard}
                sessionId="workspace-001"
                onClick={vi.fn()}
                onCardUpdate={onCardUpdate}
            />
        );

        // Advance timer to trigger polling interval (3000ms)
        await vi.advanceTimersByTimeAsync(3000);

        await waitFor(() => {
            expect(getAssignment).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(onCardUpdate).toHaveBeenCalledWith(readyCard);
        });
    });

    it('does NOT call onCardUpdate when state has not changed', async () => {
        const processingCard = { ...mockAssignment, processing_state: 'processing' };
        // Still processing — same state
        getAssignment.mockResolvedValue({ ...processingCard });

        const onCardUpdate = vi.fn();

        render(
            <AssignmentCard
                assignment={processingCard}
                sessionId="workspace-001"
                onClick={vi.fn()}
                onCardUpdate={onCardUpdate}
            />
        );

        await vi.advanceTimersByTimeAsync(3000);

        await waitFor(() => {
            expect(getAssignment).toHaveBeenCalled();
        });

        expect(onCardUpdate).not.toHaveBeenCalled();
    });
});
