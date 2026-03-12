/**
 * Tests for DashboardView storage awareness banner.
 *
 * Pre-launch reliability sprint:
 * - Banner is shown to new users (no localStorage flag)
 * - Banner is hidden after clicking "Got it"
 * - Banner stays hidden on re-render once dismissed (localStorage persisted)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../components/KanbanBoard', () => ({ default: () => <div data-testid="kanban" /> }));
vi.mock('../components/AssignmentDetail', () => ({ default: () => null }));

import DashboardView from '../components/DashboardView';

const defaultProps = {
    workspaceId: 'ws-1',
    assignments: [],
    fetchError: false,
    onRetryFetch: vi.fn(),
    onAskAI: vi.fn(),
    onAssignmentUpdate: vi.fn(),
    onDeleteCard: vi.fn(),
    onCardCreated: vi.fn(),
};

describe('DashboardView — storage awareness banner', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('shows the storage banner when not previously dismissed', () => {
        render(<DashboardView {...defaultProps} />);
        expect(screen.getByText(/saved in this browser/i)).toBeInTheDocument();
    });

    it('hides the banner immediately after clicking "Got it"', () => {
        render(<DashboardView {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /got it/i }));
        expect(screen.queryByText(/saved in this browser/i)).toBeNull();
    });

    it('does not show banner when localStorage flag is already set', () => {
        localStorage.setItem('fluxnote_storage_banner_dismissed', '1');
        render(<DashboardView {...defaultProps} />);
        expect(screen.queryByText(/saved in this browser/i)).toBeNull();
    });

    it('persists dismissal to localStorage', () => {
        render(<DashboardView {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /got it/i }));
        expect(localStorage.getItem('fluxnote_storage_banner_dismissed')).toBe('1');
    });
});
