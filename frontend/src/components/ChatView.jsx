import React, { useState, useEffect, useRef } from 'react';
import { Bot, User, Paperclip, Send, ChevronDown, FileText, X } from 'lucide-react';
import {
    uploadFile,
    deleteFile,
    streamChatMessage,
    getChatHistory,
    createAssignment,
} from '../api';
import './ChatView.css';

const MODEL_MAP = {
    'Fast':       'Fast',
    'Balanced':   'Balanced',
    'Deep Think': 'Deep Think',
};

function ChatView({ sessionId, initialContext, onContextConsumed }) {
    const [selectedModel, setSelectedModel] = useState('Fast');
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [inputText, setInputText] = useState('');
    const [messages, setMessages] = useState([
        { id: 1, role: 'ai', content: 'Hello! I am your AI workspace assistant. You can chat with me, upload files for context, or manage your assignments in the Dashboard.', model: 'Fast' }
    ]);
    const [files, setFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState(null);
    const messagesEndRef = useRef(null);

    // Load chat history on mount
    useEffect(() => {
        getChatHistory(sessionId).then(data => {
            if (data.messages?.length) {
                setMessages(data.messages.map(m => ({
                    ...m,
                    role: m.role === 'assistant' ? 'ai' : 'user',
                })));
            }
        }).catch(() => {});
    }, [sessionId]);

    // Handle "Ask AI" context injected from Dashboard
    useEffect(() => {
        if (!initialContext) return;
        const contextMsg = `I want to ask about this assignment: "${initialContext.title || initialContext.filename}"\n\nSummary: ${(initialContext.summary || []).join(' ')}\n\nChecklist: ${(initialContext.checklist || []).join(', ')}`;
        setInputText(contextMsg);
        onContextConsumed?.();
    }, [initialContext]);

    // Auto-scroll to latest message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async () => {
        if (!inputText.trim() || streaming) return;
        const userMsg = { id: Date.now(), role: 'user', content: inputText };
        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setStreaming(true);
        setError(null);
        const aiMsgId = Date.now() + 1;
        setMessages(prev => [...prev, { id: aiMsgId, role: 'ai', content: '', model: selectedModel, attribution: null }]);

        await streamChatMessage({
            message: inputText,
            model: selectedModel,
            fileIds: files.map(f => f.id),
            sessionId,
            onChunk: (chunk) => {
                setMessages(prev => prev.map(m =>
                    m.id === aiMsgId ? { ...m, content: m.content + chunk } : m
                ));
            },
            onDone: (attribution) => {
                if (attribution) {
                    setMessages(prev => prev.map(m =>
                        m.id === aiMsgId ? { ...m, attribution } : m
                    ));
                }
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
                const result = await uploadFile(file, sessionId);
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
            await createAssignment(fileId, sessionId);
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
            <div className="message-list">
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
                                <div className="message-text">
                                    {msg.content}
                                    {streaming && msg.role === 'ai' && msg.content === '' && (
                                        <span className="typing-indicator">…</span>
                                    )}
                                </div>
                                {msg.attribution && (
                                    <div className="attribution-footer">
                                        ⚡ Synthesised from {msg.attribution.models_used.join(' · ')}
                                        {msg.attribution.total_tokens > 0 && (
                                            <span className="token-count"> · {msg.attribution.total_tokens.toLocaleString()} tokens</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
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
                <div className="disclaimer">
                    Fluxnote AI MVP v0.2. Founder validation build.
                </div>
            </div>
        </div>
    );
}

export default ChatView;
