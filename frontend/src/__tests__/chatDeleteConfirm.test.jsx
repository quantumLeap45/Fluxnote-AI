/**
 * Tests for Sidebar chat delete confirmation.
 *
 * Pre-launch reliability sprint:
 * - Clicking trash icon must show window.confirm before calling onDeleteChat
 * - Cancelling the dialog must NOT call onDeleteChat
 * - Confirming the dialog must call onDeleteChat with the correct chat id
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import Sidebar from '../components/Sidebar';

const chat = { id: 'chat-abc', title: 'My Test Chat' };

const baseProps = {
    activeTab: 'chat',
    setActiveTab: vi.fn(),
    chats: [chat],
    activeChatId: 'chat-abc',
    onNewChat: vi.fn(),
    onSelectChat: vi.fn(),
    onDeleteChat: vi.fn(),
    onRenameChat: vi.fn(),
};

describe('Sidebar — chat delete confirmation', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows confirm dialog when trash is clicked', () => {
        vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
        render(<Sidebar {...baseProps} />);
        fireEvent.click(screen.getByTitle('Delete chat'));
        expect(window.confirm).toHaveBeenCalledWith('Delete this chat?');
    });

    it('does NOT call onDeleteChat when user cancels', () => {
        vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
        render(<Sidebar {...baseProps} />);
        fireEvent.click(screen.getByTitle('Delete chat'));
        expect(baseProps.onDeleteChat).not.toHaveBeenCalled();
    });

    it('calls onDeleteChat with correct id when user confirms', () => {
        vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
        render(<Sidebar {...baseProps} />);
        fireEvent.click(screen.getByTitle('Delete chat'));
        expect(baseProps.onDeleteChat).toHaveBeenCalledWith('chat-abc');
    });
});
