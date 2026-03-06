import React, { useState } from 'react';
import KanbanBoard from './KanbanBoard';
import AssignmentDetail from './AssignmentDetail';
import './DashboardView.css';

function DashboardView({ workspaceId, assignments, onAskAI, onAssignmentUpdate, onDeleteCard, onCardCreated }) {
    const [selectedCard, setSelectedCard] = useState(null);

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
                />
            )}
        </div>
    );
}

export default DashboardView;
