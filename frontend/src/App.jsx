import React, { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import DashboardView from './components/DashboardView';
import OnboardingTour from './components/OnboardingTour';
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

const THEME_KEY = 'fluxnote_theme';

function getEffectiveTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function App() {
    const [activeChatId, setActiveChatId]     = useState(() => getSessionId());
    const [workspaceId]                       = useState(() => getWorkspaceId());
    const [chats, setChats]                   = useState(() => getStoredChats());
    const [activeTab, setActiveTab]           = useState('chat');
    const [chatContext, setChatContext]       = useState(null);
    const [assignments, setAssignments]       = useState([]);
    const [assignmentFetchError, setAssignmentFetchError] = useState(false);
    const historyCacheRef                     = useRef(new Map());

    // ── Theme ─────────────────────────────────────────────────────────────────
    const [theme, setTheme] = useState(getEffectiveTheme);

    // Apply stored preference to DOM on first mount
    useEffect(() => {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored) document.documentElement.setAttribute('data-theme', stored);
    }, []);

    const handleThemeToggle = useCallback((buttonEl) => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';

        const applySwitch = () => {
            localStorage.setItem(THEME_KEY, newTheme);
            document.documentElement.setAttribute('data-theme', newTheme);
            setTheme(newTheme);
        };

        // View Transitions ripple — graceful fallback for older browsers
        if (!document.startViewTransition || !buttonEl) {
            applySwitch();
            return;
        }

        const rect = buttonEl.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y),
        );

        const transition = document.startViewTransition(applySwitch);
        transition.ready.then(() => {
            document.documentElement.animate(
                { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
                { duration: 500, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' },
            );
        });
    }, [theme]);

    // ── Onboarding ────────────────────────────────────────────────────────────
    // Mark as seen immediately on first load so closing the browser mid-tour
    // doesn't cause it to repeat on every subsequent visit.
    const [showOnboarding, setShowOnboarding] = useState(() => {
        if (!localStorage.getItem('fluxnote_onboarded')) {
            localStorage.setItem('fluxnote_onboarded', '1');
            return true;
        }
        return false;
    });

    const handleOnboardingComplete = useCallback(() => {
        localStorage.setItem('fluxnote_onboarded', '1');
        // Suppress hint banners — tour already covered those areas
        localStorage.setItem('fluxnote_hint_chat', '1');
        localStorage.setItem('fluxnote_hint_dashboard', '1');
        setShowOnboarding(false);
    }, []);

    const handleReplayOnboarding = useCallback(() => {
        localStorage.removeItem('fluxnote_onboarded');
        localStorage.removeItem('fluxnote_hint_chat');
        localStorage.removeItem('fluxnote_hint_dashboard');
        setShowOnboarding(true);
    }, []);

    // ── Chats & assignments ───────────────────────────────────────────────────
    const refreshChats = useCallback(() => setChats(getStoredChats()), []);

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
                    theme={theme}
                    onThemeToggle={handleThemeToggle}
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

            <OnboardingTour
                run={showOnboarding}
                theme={theme}
                onComplete={handleOnboardingComplete}
                setActiveTab={setActiveTab}
            />
        </>
    );
}

export default App;
