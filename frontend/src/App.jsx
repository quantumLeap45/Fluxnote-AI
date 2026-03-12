import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import DashboardView from './components/DashboardView';
import OnboardingModal from './components/OnboardingModal';
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
    clearChatHistory,
} from './api';

function App() {
    const [activeChatId, setActiveChatId]     = useState(() => getSessionId());
    const [workspaceId]                       = useState(() => getWorkspaceId());
    const [chats, setChats]                   = useState(() => getStoredChats());
    const [activeTab, setActiveTab]           = useState('chat');
    const [chatContext, setChatContext]       = useState(null);
    const [assignments, setAssignments]       = useState([]);
    const [assignmentFetchError, setAssignmentFetchError] = useState(false);
    const historyCacheRef                     = useRef(new Map());

    const [showOnboarding, setShowOnboarding] = useState(
        () => !localStorage.getItem('fluxnote_onboarded')
    );

    const handleOnboardingComplete = useCallback(() => {
        localStorage.setItem('fluxnote_onboarded', '1');
        setShowOnboarding(false);
    }, []);

    const handleReplayOnboarding = useCallback(() => {
        localStorage.removeItem('fluxnote_onboarded');
        localStorage.removeItem('fluxnote_hint_chat');
        localStorage.removeItem('fluxnote_hint_dashboard');
        setShowOnboarding(true);
    }, []);

    const refreshChats = useCallback(() => setChats(getStoredChats()), []);

    // Fetch assignments once — persists across tab switches
    useEffect(() => {
        listAssignments(workspaceId)
            .then(data => {
                setAssignments(data.assignments || []);
                setAssignmentFetchError(false);
            })
            .catch(() => setAssignmentFetchError(true));
    }, [workspaceId]);

    const handleNewChat = useCallback(() => {
        const newId = createNewChatSession();
        setActiveChatId(newId);
        setChats(getStoredChats());
        setActiveTab('chat');
        setChatContext(null);
    }, []);

    const handleSelectChat = useCallback((id) => {
        switchChatSession(id);
        setActiveChatId(id);
        setActiveTab('chat');
        setChatContext(null);
    }, []);

    const handleDeleteChat = useCallback(async (id) => {
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
        // Best-effort: delete backend messages. UI already updated; show notice on failure.
        clearChatHistory(id).catch(() => {
            alert('Chat removed locally. Could not clear server history — some messages may remain.');
        });
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
        } catch {
            alert('Failed to delete assignment. Please try again.');
        }
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
        <>
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
                onReplayOnboarding={handleReplayOnboarding}
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
                        historyCache={historyCacheRef.current}
                        assignments={assignments}
                        onCardCreated={handleCardCreated}
                    />
                )}
                {activeTab === 'dashboard' && (
                    <DashboardView
                        workspaceId={workspaceId}
                        assignments={assignments}
                        fetchError={assignmentFetchError}
                        onRetryFetch={() => {
                            setAssignmentFetchError(false);
                            listAssignments(workspaceId)
                                .then(data => setAssignments(data.assignments || []))
                                .catch(() => setAssignmentFetchError(true));
                        }}
                        onAskAI={openChatWithContext}
                        onAssignmentUpdate={handleAssignmentUpdate}
                        onDeleteCard={handleDeleteCard}
                        onCardCreated={handleCardCreated}
                    />
                )}
            </main>
        </div>
        {showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}
        </>
    );
}

export default App;
