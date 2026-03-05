const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// ── Session & Chat History ──────────────────────────────────────────────────
const ACTIVE_CHAT_KEY = 'fluxnote_active_chat';
const CHATS_KEY       = 'fluxnote_chats';

export const getSessionId = () => {
    // Migrate from old key if needed
    let id = localStorage.getItem(ACTIVE_CHAT_KEY)
          || localStorage.getItem('fluxnote_session_id');
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(ACTIVE_CHAT_KEY, id);
    } else {
        localStorage.setItem(ACTIVE_CHAT_KEY, id);
    }
    return id;
};

export const createNewChatSession = () => {
    const id = crypto.randomUUID();
    localStorage.setItem(ACTIVE_CHAT_KEY, id);
    return id;
};

export const switchChatSession = (id) => {
    localStorage.setItem(ACTIVE_CHAT_KEY, id);
};

export const getStoredChats = () => {
    try { return JSON.parse(localStorage.getItem(CHATS_KEY) || '[]'); }
    catch { return []; }
};

export const storeChatTitle = (id, firstMessage) => {
    const chats = getStoredChats();
    const idx = chats.findIndex(c => c.id === id);
    if (idx >= 0) return; // title already set — don't overwrite
    chats.unshift({ id, title: firstMessage.slice(0, 55), created_at: new Date().toISOString() });
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, 40)));
};

export const removeStoredChat = (id) => {
    const chats = getStoredChats().filter(c => c.id !== id);
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
};

export const renameChatTitle = (id, newTitle) => {
    const chats = getStoredChats();
    const idx = chats.findIndex(c => c.id === id);
    if (idx < 0) return;
    chats[idx] = { ...chats[idx], title: newTitle.trim().slice(0, 55) };
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
};

// ── Supabase Storage — direct browser upload (bypasses Vercel 4.5MB limit) ──
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const uploadToStorage = async (file, sessionId) => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error('Supabase storage is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
    }
    const MAX_BYTES = 20 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
        throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.`);
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${sessionId}/${Date.now()}-${safeName}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/uploads/${path}?upsert=true`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Storage upload failed (${res.status})`);
    }
    return { path, name: file.name };
};

export const processStorageFile = async (storagePath, filename, sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/files/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path: storagePath, filename, session_id: sessionId }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'File processing failed');
    return res.json();
};

// ── Files ──────────────────────────────────────────────────────────────────
export const uploadFile = async (file, sessionId) => {
    const MAX_BYTES = 4 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
        throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 4 MB.`);
    }
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    let res;
    try {
        res = await fetch(`${API_BASE}/api/v1/chat/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, model, file_ids: fileIds, session_id: sessionId }),
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timeoutId);
        onError(err.name === 'AbortError' ? 'Request timed out — please try again.' : 'Network error — please check your connection.');
        return;
    }
    clearTimeout(timeoutId);
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
                if (data.type === 'done')  onDone(data.routed ? { models_used: data.models_used, total_tokens: data.total_tokens } : null);
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

export const createAssignmentMulti = async (fileIds, sessionId) => {
    const res = await fetch(`${API_BASE}/api/v1/assignments/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: fileIds, session_id: sessionId }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Failed to create card');
    return res.json();
};
