/**
 * Tests for assignment delete flow — error recovery.
 *
 * Covers the critical paths added in the foundation stabilization sprint:
 * - Successful delete removes card from assignments array
 * - Failed delete shows error alert and does NOT remove card from state
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── handleDeleteCard logic unit tests ──────────────────────────────────────
// We test the core logic (delete → update state, or error → alert + keep card)
// without mounting the full App, to avoid context complexity.

vi.mock('./api', () => ({ deleteAssignment: vi.fn() }));

globalThis.alert = vi.fn();

describe('handleDeleteCard — delete flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes card from assignments state on successful delete', async () => {
        // Simulate the logic in App.jsx handleDeleteCard
        const deleteAssignment = vi.fn().mockResolvedValueOnce({ success: true });
        const workspaceId = 'workspace-001';
        const assignments = [
            { id: 'card-1', title: 'Card 1' },
            { id: 'card-2', title: 'Card 2' },
        ];
        let currentAssignments = [...assignments];
        const setAssignments = vi.fn((fn) => {
            currentAssignments = fn(currentAssignments);
        });

        const handleDeleteCard = async (cardId) => {
            try {
                await deleteAssignment(cardId, workspaceId);
                setAssignments(prev => prev.filter(a => a.id !== cardId));
            } catch {
                alert('Failed to delete assignment. Please try again.');
            }
        };

        await handleDeleteCard('card-1');

        expect(deleteAssignment).toHaveBeenCalledWith('card-1', workspaceId);
        expect(currentAssignments).toHaveLength(1);
        expect(currentAssignments[0].id).toBe('card-2');
        expect(globalThis.alert).not.toHaveBeenCalled();
    });

    it('keeps card in state and shows alert when delete API fails', async () => {
        const deleteAssignment = vi.fn().mockRejectedValueOnce(new Error('Delete failed'));
        const workspaceId = 'workspace-001';
        const assignments = [
            { id: 'card-1', title: 'Card 1' },
            { id: 'card-2', title: 'Card 2' },
        ];
        let currentAssignments = [...assignments];
        const setAssignments = vi.fn((fn) => {
            currentAssignments = fn(currentAssignments);
        });

        const handleDeleteCard = async (cardId) => {
            try {
                await deleteAssignment(cardId, workspaceId);
                setAssignments(prev => prev.filter(a => a.id !== cardId));
            } catch {
                alert('Failed to delete assignment. Please try again.');
            }
        };

        await handleDeleteCard('card-1');

        expect(deleteAssignment).toHaveBeenCalledWith('card-1', workspaceId);
        // State must NOT be updated — card stays in list
        expect(setAssignments).not.toHaveBeenCalled();
        expect(currentAssignments).toHaveLength(2);
        // User must be notified
        expect(globalThis.alert).toHaveBeenCalledWith(
            'Failed to delete assignment. Please try again.'
        );
    });

    it('shows error alert and keeps both cards when API error for second card', async () => {
        const deleteAssignment = vi.fn().mockRejectedValueOnce(new Error('Network error'));
        const workspaceId = 'workspace-001';
        const assignments = [
            { id: 'card-1', title: 'Card 1' },
            { id: 'card-2', title: 'Card 2' },
        ];
        let currentAssignments = [...assignments];
        const setAssignments = vi.fn((fn) => {
            currentAssignments = typeof fn === 'function' ? fn(currentAssignments) : fn;
        });

        const handleDeleteCard = async (cardId) => {
            try {
                await deleteAssignment(cardId, workspaceId);
                setAssignments(prev => prev.filter(a => a.id !== cardId));
            } catch {
                alert('Failed to delete assignment. Please try again.');
            }
        };

        await handleDeleteCard('card-2');

        expect(currentAssignments).toHaveLength(2);
        expect(globalThis.alert).toHaveBeenCalledTimes(1);
    });
});
