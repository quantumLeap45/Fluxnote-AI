import React, { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import DashboardView from './components/DashboardView';
import {
    getSessionId,
    createNewChatSession,
    switchChatSession,
    getStoredChats,
    storeChatTitle,
    removeStoredChat,
} from './api';

function App() {
    const [activeChatId, setActiveChatId] = useState(() => getSessionId());
    const [chats, setChats] = useState(() => getStoredChats());
    const [activeTab, setActiveTab] = useState('chat');
    const [chatContext, setChatContext] = useState(null);

    const refreshChats = useCallback(() => setChats(getStoredChats()), []);

    const handleNewChat = useCallback(() => {
        const newId = createNewChatSession();
        setActiveChatId(newId);
        setActiveTab('chat');
        setChatContext(null);
    }, []);

    const handleSelectChat = useCallback((id) => {
        switchChatSession(id);
        setActiveChatId(id);
        setActiveTab('chat');
        setChatContext(null);
    }, []);

    const handleDeleteChat = useCallback((id) => {
        removeStoredChat(id);
        refreshChats();
        if (id === activeChatId) {
            const remaining = getStoredChats();
            if (remaining.length > 0) {
                handleSelectChat(remaining[0].id);
            } else {
                handleNewChat();
            }
        }
    }, [activeChatId, refreshChats, handleSelectChat, handleNewChat]);

    const handleFirstMessage = useCallback((id, message) => {
        storeChatTitle(id, message);
        refreshChats();
    }, [refreshChats]);

    const openChatWithContext = useCallback((assignment) => {
        setChatContext(assignment);
        setActiveTab('chat');
    }, []);

    return (
        <div className="app-container">
            <Sidebar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                chats={chats}
                activeChatId={activeChatId}
                onNewChat={handleNewChat}
                onSelectChat={handleSelectChat}
                onDeleteChat={handleDeleteChat}
            />
            <main className="main-content">
                {activeTab === 'chat' && (
                    <ChatView
                        key={activeChatId}
                        sessionId={activeChatId}
                        initialContext={chatContext}
                        onContextConsumed={() => setChatContext(null)}
                        onFirstMessage={handleFirstMessage}
                    />
                )}
                {activeTab === 'dashboard' && (
                    <DashboardView sessionId={activeChatId} onAskAI={openChatWithContext} />
                )}
            </main>
        </div>
    );
}

export default App;
