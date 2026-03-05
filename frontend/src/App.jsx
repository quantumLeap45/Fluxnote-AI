import React, { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import DashboardView from './components/DashboardView';
import { getSessionId } from './api';

const sessionId = getSessionId(); // stable for app lifetime

function App() {
    const [activeTab, setActiveTab] = useState('chat');
    const [chatContext, setChatContext] = useState(null); // {assignment} for "Ask AI"

    const openChatWithContext = useCallback((assignment) => {
        setChatContext(assignment);
        setActiveTab('chat');
    }, []);

    return (
        <div className="app-container">
            <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
            <main className="main-content">
                {activeTab === 'chat' && (
                    <ChatView
                        sessionId={sessionId}
                        initialContext={chatContext}
                        onContextConsumed={() => setChatContext(null)}
                    />
                )}
                {activeTab === 'dashboard' && (
                    <DashboardView sessionId={sessionId} onAskAI={openChatWithContext} />
                )}
            </main>
        </div>
    );
}

export default App;
