import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import DashboardView from './components/DashboardView';
import {
    getSessionId,
    getWorkspaceId,
    createNewChatSession,
    switchChatSession,
    getStoredChats,
    storeChatTitle,
    removeStoredChat,
    renameChatTitle,
    listAssignments,
    deleteAssignment,
} from './api';

function App() {
    const [activeChatId, setActiveChatId]   = useState(() => getSessionId());
    const [workspaceId]                     = useState(() => getWorkspaceId());
    const [chats, setChats]                 = useState(() => getStoredChats());
    const [activeTab, setActiveTab]         = useState('chat');
    const [chatContext, setChatContext]     = useState(null);
    const [assignments, setAssignments]     = useState([]);

    const refreshChats = useCallback(() => setChats(getStoredChats()), []);

    // Fetch assignments once — persists across tab switches
    useEffect(() => {
        listAssignments(workspaceId)
            .then(data => setAssignments(data.assignments || []))
            .catch(() => {});
    }, [workspaceId]);

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

    const handleRenameChat = useCallback((id, newTitle) => {
        renameChatTitle(id, newTitle);
        refreshChats();
    }, [refreshChats]);

    // Assignment handlers (moved from DashboardView)
    const handleAssignmentUpdate = useCallback((updated) => {
        setAssignments(prev => prev.map(a => a.id === updated.id ? updated : a));
    }, []);

    const handleDeleteCard = useCallback(async (cardId) => {
        try {
            await deleteAssignment(cardId, workspaceId);
            setAssignments(prev => prev.filter(a => a.id !== cardId));
        } catch { /* silent */ }
    }, [workspaceId]);

    const handleCardCreated = useCallback((card) => {
        setAssignments(prev => [card, ...prev]);
    }, []);

    // "Ask AI" — creates a fresh chat session, injects assignment context
    const openChatWithContext = useCallback((assignment) => {
        const newId = createNewChatSession();
        storeChatTitle(newId, `Ask AI: ${(assignment.title || assignment.filename).slice(0, 50)}`);
        setActiveChatId(newId);
        refreshChats();
        setChatContext(assignment);
        setActiveTab('chat');
    }, [refreshChats]);

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
                onRenameChat={handleRenameChat}
            />
            <main className="main-content">
                {activeTab === 'chat' && (
                    <ChatView
                        key={activeChatId}
                        sessionId={activeChatId}
                        workspaceId={workspaceId}
                        initialContext={chatContext}
                        onContextConsumed={() => setChatContext(null)}
                        onFirstMessage={handleFirstMessage}
                    />
                )}
                {activeTab === 'dashboard' && (
                    <DashboardView
                        workspaceId={workspaceId}
                        assignments={assignments}
                        onAskAI={openChatWithContext}
                        onAssignmentUpdate={handleAssignmentUpdate}
                        onDeleteCard={handleDeleteCard}
                        onCardCreated={handleCardCreated}
                    />
                )}
            </main>
        </div>
    );
}

export default App;
