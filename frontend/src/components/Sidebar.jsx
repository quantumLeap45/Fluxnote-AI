import React from 'react';
import { MessageSquare, LayoutDashboard, Plus, Trash2 } from 'lucide-react';
import './Sidebar.css';

function Sidebar({ activeTab, setActiveTab, chats, activeChatId, onNewChat, onSelectChat, onDeleteChat }) {
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

            {chats.length > 0 && (
                <div className="sidebar-section">
                    <h3 className="section-title">Recent Chats</h3>
                    <ul className="chat-history-list">
                        {chats.map(chat => (
                            <li
                                key={chat.id}
                                className={`chat-history-item ${chat.id === activeChatId ? 'active' : ''}`}
                            >
                                <button
                                    className="chat-history-title"
                                    onClick={() => onSelectChat(chat.id)}
                                    title={chat.title}
                                >
                                    {chat.title}
                                </button>
                                <button
                                    className="chat-history-delete"
                                    onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id); }}
                                    title="Delete chat"
                                >
                                    <Trash2 size={13} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </aside>
    );
}

export default Sidebar;
