import React, { useState, useEffect } from 'react';
import KanbanBoard from './KanbanBoard';
import AssignmentDetail from './AssignmentDetail';
import { listAssignments, deleteAssignment } from '../api';
import './DashboardView.css';

function DashboardView({ sessionId, onAskAI }) {
    const [assignments, setAssignments] = useState([]);
    const [selectedCard, setSelectedCard] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        listAssignments(sessionId)
            .then(data => setAssignments(data.assignments || []))
            .catch(() => {});
    }, [sessionId]);

    const handleCardCreated = (card) => {
        setAssignments(prev => [card, ...prev]);
    };

    const handleAssignmentUpdate = (updated) => {
        setAssignments(prev => prev.map(a => a.id === updated.id ? updated : a));
    };

    const handleDeleteCard = async (cardId) => {
        try {
            await deleteAssignment(cardId, sessionId);
            setAssignments(prev => prev.filter(a => a.id !== cardId));
            if (selectedCard?.id === cardId) setSelectedCard(null);
        } catch { /* silent */ }
    };

    return (
        <div className="dashboard-container animate-fade-in">
            <header className="dashboard-header">
                <div>
                    <h2 className="dashboard-title">Assignment Dashboard</h2>
                    <p className="dashboard-subtitle">Drag cards across columns to track your progress.</p>
                </div>
            </header>

            {error && (
                <div className="error-banner">
                    {error}
                    <button onClick={() => setError(null)}>✕</button>
                </div>
            )}

            <KanbanBoard
                assignments={assignments}
                sessionId={sessionId}
                onCardClick={setSelectedCard}
                onAssignmentUpdate={handleAssignmentUpdate}
                onDeleteCard={handleDeleteCard}
                onCardCreated={handleCardCreated}
            />

            {selectedCard && (
                <AssignmentDetail
                    assignment={selectedCard}
                    sessionId={sessionId}
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
