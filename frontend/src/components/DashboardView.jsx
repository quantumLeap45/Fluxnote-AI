import React, { useState } from 'react';
import KanbanBoard from './KanbanBoard';
import AssignmentDetail from './AssignmentDetail';
import './DashboardView.css';

const BANNER_KEY = 'fluxnote_storage_banner_dismissed';

function DashboardView({ workspaceId, assignments, fetchError, onRetryFetch, onAskAI, onAssignmentUpdate, onDeleteCard, onCardCreated }) {
    const [selectedCard, setSelectedCard] = useState(null);
    const [bannerDismissed, setBannerDismissed] = useState(
        () => !!localStorage.getItem(BANNER_KEY)
    );

    const dismissBanner = () => {
        localStorage.setItem(BANNER_KEY, '1');
        setBannerDismissed(true);
    };

    const handleDeleteCard = async (cardId) => {
        await onDeleteCard(cardId);
        if (selectedCard?.id === cardId) setSelectedCard(null);
    };

    return (
        <div className="dashboard-container animate-fade-in">
            <header className="dashboard-header">
                <div>
                    <h2 className="dashboard-title">Assignment Dashboard</h2>
                    <p className="dashboard-subtitle">Drag cards across columns to track your progress.</p>
                </div>
            </header>

            {!bannerDismissed && (
                <div style={{ padding: '10px 16px', marginBottom: '12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <span>Your dashboard is saved in this browser — not synced across devices. Opening Fluxnote on a different browser or device will show an empty dashboard.</span>
                    <button
                        aria-label="Got it"
                        onClick={dismissBanner}
                        style={{ marginLeft: 'auto', padding: '3px 10px', background: 'transparent', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}
                    >
                        Got it
                    </button>
                </div>
            )}

            {fetchError && (
                <div style={{ padding: '12px 16px', marginBottom: '12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>Failed to load assignments.</span>
                    <button onClick={onRetryFetch} style={{ marginLeft: 'auto', padding: '4px 12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Retry</button>
                </div>
            )}

            <KanbanBoard
                assignments={assignments}
                sessionId={workspaceId}
                onCardClick={setSelectedCard}
                onAssignmentUpdate={onAssignmentUpdate}
                onDeleteCard={handleDeleteCard}
                onCardCreated={onCardCreated}
            />

            {selectedCard && (
                <AssignmentDetail
                    assignment={selectedCard}
                    sessionId={workspaceId}
                    onClose={() => setSelectedCard(null)}
                    onAskAI={(card) => {
                        setSelectedCard(null);
                        onAskAI(card);
                    }}
                    onAssignmentUpdate={onAssignmentUpdate}
                />
            )}
        </div>
    );
}

export default DashboardView;
