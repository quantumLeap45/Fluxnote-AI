import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Bot, User, Paperclip, Send, ChevronDown, FileText, X } from 'lucide-react';
import {
    uploadFile,
    uploadToStorage,
    processStorageFile,
    deleteFile,
    streamChatMessage,
    getChatHistory,
    createAssignment,
} from '../api';

const SUPABASE_CONFIGURED = !!(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);
import './ChatView.css';

const MODEL_MAP = {
    'Fast':       'Fast',
    'Balanced':   'Balanced',
    'Deep Think': 'Deep Think',
};

const WELCOME_MSG = { id: 1, role: 'ai', content: "Hi! I'm Fluxnote — ask me anything: assignments, study help, writing, or general topics. I can see your dashboard, so just ask about your assignments anytime!", model: 'Fast' };

function buildAssignmentsManifest(assignments) {
    if (!assignments?.length) return '[STUDENT DASHBOARD — 0 assignments]\nNo assignments added yet.';
    const lines = assignments.map((a, i) => {
        const parts = [
            a.title || a.filename || 'Untitled',
            a.module || 'No module',
            `Due: ${a.due_date || 'Not stated'}`,
            a.weightage || '',
            a.assignment_type || '',
        ].filter(Boolean);
        return `#${i + 1} [id:${a.id}] ${parts.join(' | ')}`;
    });
    return `[STUDENT DASHBOARD — ${assignments.length} assignment${assignments.length !== 1 ? 's' : ''}]\n${lines.join('\n')}`;
}


function ChatView({ sessionId, workspaceId, initialContext, onContextConsumed, onFirstMessage, historyCache, assignments }) {
    const [selectedModel, setSelectedModel] = useState('Fast');
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [inputText, setInputText] = useState('');
    const [messages, setMessages] = useState([]);
    const [files, setFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState(null);
    const messageListRef = useRef(null);
    const textareaRef = useRef(null);
    const assignmentContextRef = useRef(null);
    const assignmentFileIdsRef = useRef([]);

    // Cache messages on unmount so switching back is instant
    const messagesRef = useRef(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => {
        return () => { if (historyCache && messagesRef.current.length) historyCache.set(sessionId, messagesRef.current); };
    }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load chat history on mount — check cache first
    useEffect(() => {
        const cached = historyCache?.get(sessionId);
        if (cached) { setMessages(cached); return; }
        getChatHistory(sessionId).then(data => {
            if (data.messages?.length) {
                setMessages(data.messages.map(m => ({
                    ...m,
                    role: m.role === 'assistant' ? 'ai' : 'user',
                })));
            } else {
                setMessages([WELCOME_MSG]);
            }
        }).catch(() => { setMessages([WELCOME_MSG]); });
    }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Handle "Ask AI" context — pre-fill textarea, store metadata for first send + file IDs for whole session
    useEffect(() => {
        if (!initialContext) return;
        assignmentContextRef.current = initialContext;
        assignmentFileIdsRef.current = initialContext.file_ids
            || (initialContext.file_id ? [initialContext.file_id] : []);
        setInputText(`Help me understand my assignment: "${initialContext.title || initialContext.filename}"`);
        onContextConsumed?.();
    }, [initialContext]);

    // Auto-scroll to latest message — scroll container, not the page
    useEffect(() => {
        const el = messageListRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages]);

    // Auto-resize textarea as content grows (capped at 200px by CSS)
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [inputText]);

    const handleSend = async () => {
        if (!inputText.trim() || streaming) return;

        // Build the message shown in the UI bubble (always clean)
        const displayText = inputText;

        // Build the message sent to the API (may include invisible assignment context on first send)
        let apiMessage = inputText;
        if (assignmentContextRef.current) {
            const ctx = assignmentContextRef.current;
            const parts = [
                ctx.module      && `Module: ${ctx.module}`,
                ctx.due_date    && `Due date: ${ctx.due_date}`,
                ctx.weightage   && `Weightage: ${ctx.weightage}`,
                ctx.constraints && `Constraints: ${ctx.constraints}`,
                ctx.summary?.length  && `Summary:\n${ctx.summary.map(s => `• ${s}`).join('\n')}`,
                ctx.checklist?.length && `Checklist:\n${ctx.checklist.map(c => `• ${c}`).join('\n')}`,
            ].filter(Boolean).join('\n');
            apiMessage = `${inputText}\n\n[Assignment context — ${ctx.title || ctx.filename}]\n${parts}`;
            assignmentContextRef.current = null;
        }

        const userMsg = { id: Date.now(), role: 'user', content: displayText };
        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setStreaming(true);
        setError(null);

        onFirstMessage?.(sessionId, displayText);
        const aiMsgId = Date.now() + 1;
        const isDeepThink = selectedModel === 'Deep Think';
        const isRouted    = selectedModel === 'Routed';
        const aiMsg = {
            id: aiMsgId, role: 'ai', content: '', model: selectedModel, attribution: null,
            ...(isDeepThink && { thinking: '', thinkingDone: false }),
            ...(isRouted    && { routingStep: 'classifying', routingModels: [], routingTask: null }),
        };
        setMessages(prev => [...prev, aiMsg]);

        await streamChatMessage({
            message: apiMessage,
            model: selectedModel,
            fileIds: [...assignmentFileIdsRef.current, ...files.map(f => f.id)],
            sessionId,
            assignmentsManifest: buildAssignmentsManifest(assignments),
            workspaceId,
            onChunk: (chunk) => {
                setMessages(prev => prev.map(m =>
                    m.id === aiMsgId ? { ...m, content: m.content + chunk } : m
                ));
            },
            onThinkingChunk: (chunk) => {
                setMessages(prev => prev.map(m =>
                    m.id === aiMsgId ? { ...m, thinking: (m.thinking || '') + chunk } : m
                ));
            },
            onRoutingStatus: (data) => {
                setMessages(prev => prev.map(m =>
                    m.id === aiMsgId ? {
                        ...m,
                        routingStep:   data.step,
                        routingModels: data.models || m.routingModels,
                        routingTask:   data.task   || m.routingTask,
                    } : m
                ));
            },
            onDone: (attribution) => {
                setMessages(prev => prev.map(m => {
                    if (m.id !== aiMsgId) return m;
                    return { ...m, attribution, thinkingDone: true };
                }));
                setStreaming(false);
            },
            onError: (msg) => {
                setError(msg);
                setStreaming(false);
            },
        });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleFileUpload = async (e) => {
        const selectedFiles = Array.from(e.target.files);
        for (const file of selectedFiles) {
            if (files.length >= 5) break;
            setUploading(true);
            try {
                let result;
                if (SUPABASE_CONFIGURED) {
                    const { path } = await uploadToStorage(file, sessionId);
                    result = await processStorageFile(path, file.name, sessionId);
                } else {
                    result = await uploadFile(file, sessionId);
                }
                setFiles(prev => [...prev, { ...result, addedToDashboard: false }]);
            } catch (err) {
                setError(`Upload failed: ${err.message}`);
            } finally {
                setUploading(false);
            }
        }
        e.target.value = '';
    };

    const removeFile = async (id) => {
        try {
            await deleteFile(id, sessionId);
        } catch { /* silent — remove from UI regardless */ }
        setFiles(prev => prev.filter(f => f.id !== id));
    };

    const handleAddToDashboard = async (fileId) => {
        try {
            await createAssignment(fileId, workspaceId);
            setFiles(prev => prev.map(f => f.id === fileId ? { ...f, addedToDashboard: true } : f));
        } catch (err) {
            setError(`Could not create assignment card: ${err.message}`);
        }
    };

    return (
        <div className="chat-container animate-fade-in">
            {/* Header Area */}
            <header className="chat-header">
                <div className="model-selector">
                    <button
                        className="model-select-btn"
                        onClick={() => setShowModelDropdown(!showModelDropdown)}
                    >
                        <Bot size={16} />
                        <span className="model-name">{selectedModel}</span>
                        <span className="model-badge">Model</span>
                        <ChevronDown size={14} />
                    </button>

                    {showModelDropdown && (
                        <div className="model-dropdown animate-fade-in">
                            {['Fast', 'Balanced', 'Deep Think'].map(model => (
                                <button
                                    key={model}
                                    className={`model-option ${selectedModel === model ? 'selected' : ''}`}
                                    onClick={() => {
                                        setSelectedModel(model);
                                        setShowModelDropdown(false);
                                    }}
                                >
                                    {model}
                                </button>
                            ))}
                            <div className="model-divider" />
                            <button
                                className={`model-option model-option-routed ${selectedModel === 'Routed' ? 'selected' : ''}`}
                                onClick={() => {
                                    setSelectedModel('Routed');
                                    setShowModelDropdown(false);
                                }}
                            >
                                ⚡ Routed
                                <span className="routed-tag">Multi-AI</span>
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {/* Error Banner */}
            {error && (
                <div className="error-banner">
                    {error}
                    <button onClick={() => setError(null)}>✕</button>
                </div>
            )}

            {/* Message List */}
            <div className="message-list" ref={messageListRef}>
                <div className="messages-wrapper">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`message-row ${msg.role}`}>
                            <div className="message-avatar">
                                {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                            </div>
                            <div className="message-content">
                                {msg.role === 'ai' && (
                                    <div className="message-metadata">
                                        {msg.model === 'Routed' ? '⚡ Routed' : msg.model}
                                    </div>
                                )}
                                {/* Routing status panel — Routed mode only, while gathering */}
                                {msg.routingStep && !msg.attribution && (
                                    <RoutingStatusPanel
                                        step={msg.routingStep}
                                        models={msg.routingModels || []}
                                        task={msg.routingTask}
                                    />
                                )}
                                {/* Thinking panel — Deep Think only */}
                                {msg.thinking !== undefined && (
                                    <ThinkingPanel
                                        thinking={msg.thinking || ''}
                                        done={msg.thinkingDone}
                                        streaming={streaming}
                                    />
                                )}
                                <div className="message-text">
                                    {msg.role === 'ai' ? (
                                        msg.content === '' && streaming && msg.thinking === undefined && !msg.routingStep
                                            ? <span className="typing-indicator">…</span>
                                            : msg.content
                                                ? <ReactMarkdown
                                                    remarkPlugins={[remarkMath, remarkGfm]}
                                                    rehypePlugins={[rehypeKatex]}
                                                  >{msg.content}</ReactMarkdown>
                                                : null
                                    ) : msg.content}
                                </div>
                                {msg.attribution && (
                                    <div className="attribution-footer">
                                        {msg.attribution.simple
                                            ? <>⚡ Routed — fast response</>
                                            : msg.attribution.models_used
                                                ? <>⚡ Synthesised from {msg.attribution.models_used.join(' · ')}</>
                                                : null}
                                        {msg.attribution.total_tokens > 0 && (
                                            <span className="token-count"> · {msg.attribution.total_tokens.toLocaleString()} tokens</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Prompt Composer */}
            <div className="prompt-composer-container">
                {/* Uploaded Files Chips */}
                {files.length > 0 && (
                    <div className="file-chips-area animate-fade-in">
                        {files.map(file => (
                            <div key={file.id} className="file-chip">
                                <FileText size={14} className="file-icon" />
                                <div className="file-details">
                                    <span className="file-name">{file.name}</span>
                                    <span className="file-size">{file.size_mb ? `${file.size_mb} MB` : ''}</span>
                                </div>
                                {!file.addedToDashboard ? (
                                    <button
                                        className="add-to-dashboard-btn"
                                        onClick={() => handleAddToDashboard(file.id)}
                                        title="Add to Assignment Dashboard"
                                    >
                                        + Dashboard
                                    </button>
                                ) : (
                                    <span className="added-badge">✓ Added</span>
                                )}
                                <button className="remove-file-btn" onClick={() => removeFile(file.id)}>
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="prompt-composer">
                    <label className="attach-btn" title="Attach file">
                        <Paperclip size={18} />
                        <input
                            type="file"
                            multiple
                            accept=".pdf,.docx,.txt,.csv,.pptx"
                            className="hidden-file-input"
                            onChange={handleFileUpload}
                            disabled={uploading || files.length >= 5}
                        />
                    </label>

                    <textarea
                        ref={textareaRef}
                        className="prompt-input"
                        placeholder="Message Fluxnote..."
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={1}
                        disabled={streaming}
                    />

                    <button
                        className={`send-btn ${inputText.trim() ? 'active' : ''}`}
                        onClick={handleSend}
                        disabled={(!inputText.trim() && files.length === 0) || streaming}
                    >
                        <Send size={16} />
                    </button>
                </div>

            </div>
        </div>
    );
}

// ── ThinkingPanel — shows Deep Think reasoning trace ─────────────────────────
function ThinkingPanel({ thinking, done, streaming }) {
    const [expanded, setExpanded] = useState(!done);
    const bodyRef = useRef(null);

    // Auto-expand while streaming; collapse when done
    useEffect(() => {
        if (!done) {
            setExpanded(true);
        } else {
            setExpanded(false);
        }
    }, [done]);

    // Auto-scroll thinking body as text arrives
    useEffect(() => {
        if (expanded && bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [thinking, expanded]);

    const hasText = thinking.length > 0;

    return (
        <div className="thinking-panel">
            <button className="thinking-header" onClick={() => setExpanded(e => !e)}>
                {!done && <span className="thinking-pulse" />}
                <span className="thinking-label">
                    {done ? 'View reasoning' : 'Thinking…'}
                </span>
                {hasText && <span className="thinking-toggle">{expanded ? '▲' : '▼'}</span>}
            </button>
            {expanded && hasText && (
                <div className="thinking-body" ref={bodyRef}>{thinking}</div>
            )}
        </div>
    );
}

// ── RoutingStatusPanel — shows Routed mode MoA progress ──────────────────────
const ROUTING_LABELS = {
    classifying: { icon: '⚡', text: 'Routing your question…' },
    gathering:   { icon: '🧠', text: null },   // text built dynamically from models
    synthesising:{ icon: '✦', text: 'Synthesising responses…' },
};

function RoutingStatusPanel({ step, models, task }) {
    const entry = ROUTING_LABELS[step];
    if (!entry) return null;

    const label = entry.text
        || (models.length ? `Consulting ${models.join(' · ')}…` : 'Consulting models…');

    return (
        <div className="routing-status">
            <span className="routing-icon">{entry.icon}</span>
            <span className="routing-label">{label}</span>
            {task && step === 'gathering' && (
                <span className="routing-task-badge">{task}</span>
            )}
        </div>
    );
}

export default ChatView;
