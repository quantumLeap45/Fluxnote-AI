import React, { useState } from 'react';
import { MessageSquare, LayoutDashboard, Plus, Trash2, Pencil, Check } from 'lucide-react';
import './Sidebar.css';

function Sidebar({ activeTab, setActiveTab, chats, activeChatId, onNewChat, onSelectChat, onDeleteChat, onRenameChat }) {
    const [renamingId, setRenamingId] = useState(null);
    const [renameValue, setRenameValue] = useState('');

    const startRename = (e, chat) => {
        e.stopPropagation();
        setRenamingId(chat.id);
        setRenameValue(chat.title);
    };

    const commitRename = (id) => {
        if (renameValue.trim()) onRenameChat(id, renameValue);
        setRenamingId(null);
    };

    const handleRenameKeyDown = (e, id) => {
        if (e.key === 'Enter') { e.preventDefault(); commitRename(id); }
        if (e.key === 'Escape') setRenamingId(null);
    };

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h1 className="logo">Fluxnote</h1>
                <button className="new-chat-btn" onClick={onNewChat}>
                    <Plus size={16} />
                    <span>New Chat</span>
                </button>
            </div>

            <nav className="sidebar-nav">
                <button
                    className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
                    onClick={() => setActiveTab('chat')}
                >
                    <MessageSquare size={18} />
                    <span>Chat</span>
                </button>
                <button
                    className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setActiveTab('dashboard')}
                >
                    <LayoutDashboard size={18} />
                    <span>Dashboard</span>
                </button>
            </nav>

            <div className="sidebar-section">
                <h3 className="section-title">Recent Chats</h3>
                {chats.length === 0 ? (
                    <p className="sidebar-empty">Your conversations will appear here</p>
                ) : (
                    <ul className="chat-history-list">
                        {chats.map(chat => (
                            <li
                                key={chat.id}
                                className={`chat-history-item ${chat.id === activeChatId ? 'active' : ''}`}
                            >
                                {renamingId === chat.id ? (
                                    <div className="rename-row">
                                        <input
                                            className="rename-input"
                                            value={renameValue}
                                            autoFocus
                                            onChange={e => setRenameValue(e.target.value)}
                                            onBlur={() => commitRename(chat.id)}
                                            onKeyDown={e => handleRenameKeyDown(e, chat.id)}
                                        />
                                        <button className="chat-history-action" onClick={() => commitRename(chat.id)}>
                                            <Check size={13} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            className="chat-history-title"
                                            onClick={() => onSelectChat(chat.id)}
                                            title={chat.title}
                                        >
                                            {chat.title}
                                        </button>
                                        <button
                                            className="chat-history-action"
                                            onClick={e => startRename(e, chat)}
                                            title="Rename chat"
                                        >
                                            <Pencil size={13} />
                                        </button>
                                        <button
                                            className="chat-history-delete"
                                            onClick={e => { e.stopPropagation(); if (window.confirm('Delete this chat?')) onDeleteChat(chat.id); }}
                                            title="Delete chat"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </aside>
    );
}

export default Sidebar;
