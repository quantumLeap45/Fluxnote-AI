/**
 * Regression tests for the file-session-vs-workspace-scope bug.
 *
 * Root cause: chat file upload stored files under sessionId (activeChatId),
 * but + Dashboard called createAssignment with workspaceId — backend lookup
 * failed with "File not found in this session" (session_id mismatch).
 *
 * Fix: all file DB operations (processStorageFile, uploadFile, deleteFile)
 * now use workspaceId so that the file row and the assignment row share the
 * same session_id in the database.
 *
 * The Supabase Storage bucket path still uses sessionId as a key — that is
 * a storage path, not a DB column, and is not affected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// ── API mock ─────────────────────────────────────────────────────────────────
vi.mock('../api', () => ({
    uploadFile:          vi.fn(),
    uploadToStorage:     vi.fn(),
    processStorageFile:  vi.fn(),
    deleteFile:          vi.fn(),
    streamChatMessage:   vi.fn(),
    getChatHistory:      vi.fn(),
    createAssignment:    vi.fn(),
}));

import {
    uploadFile,
    deleteFile,
    getChatHistory,
    createAssignment,
} from '../api';
import ChatView from '../components/ChatView';

// Distinct IDs so any mix-up is immediately visible in assertions
const SESSION_ID   = 'chat-session-aaa';
const WORKSPACE_ID = 'workspace-bbb-999';

const FAKE_FILE = { id: 'file-001', name: 'brief.pdf', size: 12000, size_mb: '0.01' };

function renderChatView() {
    return render(
        <ChatView
            sessionId={SESSION_ID}
            workspaceId={WORKSPACE_ID}
            initialContext={null}
            onContextConsumed={vi.fn()}
            onFirstMessage={vi.fn()}
            historyCache={null}
            assignments={[]}
        />
    );
}

describe('file DB scope — workspace vs session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Return empty chat history so the component renders without waiting
        getChatHistory.mockResolvedValue([]);
    });

    it('uploadFile is called with workspaceId, not sessionId', async () => {
        uploadFile.mockResolvedValueOnce(FAKE_FILE);

        renderChatView();

        const input = document.querySelector('.hidden-file-input');
        const mockFile = new File(['%PDF content'], 'brief.pdf', { type: 'application/pdf' });
        Object.defineProperty(input, 'files', { value: [mockFile], configurable: true });
        fireEvent.change(input);

        await waitFor(() => {
            expect(uploadFile).toHaveBeenCalledTimes(1);
        });

        const [, calledSessionId] = uploadFile.mock.calls[0];
        expect(calledSessionId).toBe(WORKSPACE_ID);
        expect(calledSessionId).not.toBe(SESSION_ID);
    });

    it('createAssignment is called with workspaceId after + Dashboard click', async () => {
        uploadFile.mockResolvedValueOnce(FAKE_FILE);
        createAssignment.mockResolvedValueOnce({});

        renderChatView();

        const input = document.querySelector('.hidden-file-input');
        const mockFile = new File(['%PDF content'], 'brief.pdf', { type: 'application/pdf' });
        Object.defineProperty(input, 'files', { value: [mockFile], configurable: true });
        fireEvent.change(input);

        // Wait for file chip to appear
        await waitFor(() => screen.getByText('+ Dashboard'));

        fireEvent.click(screen.getByText('+ Dashboard'));

        await waitFor(() => {
            expect(createAssignment).toHaveBeenCalledTimes(1);
        });

        const [calledFileId, calledSessionId] = createAssignment.mock.calls[0];
        expect(calledFileId).toBe(FAKE_FILE.id);
        // Both upload and createAssignment must use the same workspaceId
        // so the backend session_id check passes
        expect(calledSessionId).toBe(WORKSPACE_ID);
        expect(calledSessionId).not.toBe(SESSION_ID);
    });

    it('deleteFile is called with workspaceId when removing a file chip', async () => {
        uploadFile.mockResolvedValueOnce(FAKE_FILE);
        deleteFile.mockResolvedValueOnce({});

        renderChatView();

        const input = document.querySelector('.hidden-file-input');
        const mockFile = new File(['%PDF content'], 'brief.pdf', { type: 'application/pdf' });
        Object.defineProperty(input, 'files', { value: [mockFile], configurable: true });
        fireEvent.change(input);

        // Wait for remove button to appear (X icon button)
        await waitFor(() => screen.getByText('brief.pdf'));
        const removeBtn = document.querySelector('.remove-file-btn');
        fireEvent.click(removeBtn);

        await waitFor(() => {
            expect(deleteFile).toHaveBeenCalledTimes(1);
        });

        const [calledFileId, calledSessionId] = deleteFile.mock.calls[0];
        expect(calledFileId).toBe(FAKE_FILE.id);
        expect(calledSessionId).toBe(WORKSPACE_ID);
        expect(calledSessionId).not.toBe(SESSION_ID);
    });

    it('uploadFile and createAssignment use the same session_id (no mismatch possible)', async () => {
        uploadFile.mockResolvedValueOnce(FAKE_FILE);
        createAssignment.mockResolvedValueOnce({});

        renderChatView();

        const input = document.querySelector('.hidden-file-input');
        const mockFile = new File(['%PDF content'], 'brief.pdf', { type: 'application/pdf' });
        Object.defineProperty(input, 'files', { value: [mockFile], configurable: true });
        fireEvent.change(input);

        await waitFor(() => screen.getByText('+ Dashboard'));
        fireEvent.click(screen.getByText('+ Dashboard'));

        await waitFor(() => expect(createAssignment).toHaveBeenCalled());

        const uploadedWithId   = uploadFile.mock.calls[0][1];
        const assignedWithId   = createAssignment.mock.calls[0][1];
        expect(uploadedWithId).toBe(assignedWithId); // exact same value — no mismatch
    });
});
