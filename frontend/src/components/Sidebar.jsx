import React from 'react';
import { MessageSquare, LayoutDashboard, Plus, Settings } from 'lucide-react';
import './Sidebar.css';

function Sidebar({ activeTab, setActiveTab }) {
    const recentFiles = [
        'Q1_Financials.csv',
        'Project_Plan_v2.pdf',
        'Meeting_Notes.docx'
    ];

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h1 className="logo">Fluxnote</h1>
                <button className="new-chat-btn" onClick={() => setActiveTab('chat')}>
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
                <h3 className="section-title">Recent Files</h3>
                <ul className="file-list-preview">
                    {recentFiles.map(file => (
                        <li key={file} className="file-item-preview">
                            {file}
                        </li>
                    ))}
                </ul>
            </div>

            <div className="sidebar-footer">
                <button className="nav-item">
                    <Settings size={18} />
                    <span>Settings</span>
                </button>
            </div>
        </aside>
    );
}

export default Sidebar;
