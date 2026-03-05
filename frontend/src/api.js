const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// ── Session ────────────────────────────────────────────────────────────────
const SESSION_KEY = 'fluxnote_session_id';

export const getSessionId = () => {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(SESSION_KEY, id);
    }
    return id;
};

// ── Files ──────────────────────────────────────────────────────────────────
export const uploadFile = async (file, sessionId) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/api/v1/files/upload?session_id=${sessionId}`, {
        method: 'POST',
        body: form,
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Upload failed');
    return res.json();
};

export const listFiles = async (sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/files?session_id=${sessionId}`);
    if (!res.ok) throw new Error('Failed to load files');
    return res.json();
};

export const deleteFile = async (fileId, sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/files/${fileId}?session_id=${sessionId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    return res.json();
};

// ── Chat ───────────────────────────────────────────────────────────────────
export const streamChatMessage = async ({ message, model, fileIds, sessionId, onChunk, onDone, onError }) => {
    const res = await fetch(`${API_BASE}/api/v1/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, model, file_ids: fileIds, session_id: sessionId }),
    });
    if (!res.ok) {
        onError((await res.json()).detail || 'Request failed');
        return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'chunk') onChunk(data.content);
                if (data.type === 'done')  onDone();
                if (data.type === 'error') onError(data.message);
            } catch { /* skip malformed lines */ }
        }
    }
};

export const getChatHistory = async (sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/chat/history?session_id=${sessionId}`);
    if (!res.ok) throw new Error('Failed to load history');
    return res.json();
};

export const clearChatHistory = async (sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/chat/history?session_id=${sessionId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Clear failed');
    return res.json();
};

// ── Assignments ────────────────────────────────────────────────────────────
export const createAssignment = async (fileId, sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/assignments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, session_id: sessionId }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to create card');
    return res.json();
};

export const listAssignments = async (sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/assignments/?session_id=${sessionId}`);
    if (!res.ok) throw new Error('Failed to load assignments');
    return res.json();
};

export const getAssignment = async (assignmentId, sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/assignments/${assignmentId}?session_id=${sessionId}`);
    if (!res.ok) throw new Error('Assignment not found');
    return res.json();
};

export const updateAssignment = async (assignmentId, updates, sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/assignments/${assignmentId}?session_id=${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Update failed');
    return res.json();
};

export const deleteAssignment = async (assignmentId, sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/assignments/${assignmentId}?session_id=${sessionId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    return res.json();
};

export const retryAssignment = (assignmentId, sessionId) =>
    updateAssignment(assignmentId, { processing_state: 'queued' }, sessionId);
