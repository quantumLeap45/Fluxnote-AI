import React, { useState, useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';
import KanbanBoard from './KanbanBoard';
import AssignmentDetail from './AssignmentDetail';
import { listAssignments, uploadFile, createAssignment, deleteAssignment } from '../api';
import './DashboardView.css';

function DashboardView({ sessionId, onAskAI }) {
    const [assignments, setAssignments] = useState([]);
    const [selectedCard, setSelectedCard] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef();

    useEffect(() => {
        listAssignments(sessionId)
            .then(data => setAssignments(data.assignments || []))
            .catch(() => {});
    }, [sessionId]);

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploading(true);
        setError(null);
        try {
            const uploaded = await uploadFile(file, sessionId);
            const card = await createAssignment(uploaded.id, sessionId);
            setAssignments(prev => [{ ...card, kanban_column: 'todo' }, ...prev]);
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
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

    const hasAssignments = assignments.length > 0;

    return (
        <div className="dashboard-container animate-fade-in">
            <header className="dashboard-header">
                <div>
                    <h2 className="dashboard-title">Assignment Dashboard</h2>
                    <p className="dashboard-subtitle">
                        {hasAssignments
                            ? 'Drag cards across columns to track your progress.'
                            : 'Upload an assignment to get an AI-powered breakdown.'}
                    </p>
                </div>
                <button
                    className="upload-assignment-btn"
                    onClick={() => fileInputRef.current.click()}
                    disabled={uploading}
                >
                    {uploading ? <span className="spinner" /> : <Upload size={16} />}
                    {uploading ? 'Processing…' : 'Upload Assignment'}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.csv,.pptx"
                    style={{ display: 'none' }}
                    onChange={handleUpload}
                />
            </header>

            {error && (
                <div className="error-banner">
                    {error}
                    <button onClick={() => setError(null)}>✕</button>
                </div>
            )}

            {!hasAssignments && !uploading && (
                <div className="empty-state">
                    <p>No assignments yet — upload a file to get started.</p>
                </div>
            )}

            {hasAssignments && (
                <KanbanBoard
                    assignments={assignments}
                    sessionId={sessionId}
                    onCardClick={setSelectedCard}
                    onAssignmentUpdate={handleAssignmentUpdate}
                />
            )}

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
