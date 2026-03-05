import React, { useState, useEffect, useRef } from 'react';
import { Upload, Plus } from 'lucide-react';
import AssignmentCard from './AssignmentCard';
import AssignmentDetail from './AssignmentDetail';
import { listAssignments, uploadFile, createAssignment } from '../api';
import './DashboardView.css';

function DashboardView({ sessionId, onAskAI }) {
    const [assignments, setAssignments]   = useState([]);
    const [selectedCard, setSelectedCard] = useState(null);
    const [uploading, setUploading]       = useState(false);
    const [error, setError]               = useState(null);
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
            setAssignments(prev => [card, ...prev]);
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    return (
        <div className="dashboard-container animate-fade-in">
            <header className="dashboard-header">
                <div>
                    <h2 className="dashboard-title">Assignment Dashboard</h2>
                    <p className="dashboard-subtitle">Upload an assignment to get an AI-powered breakdown.</p>
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

            {assignments.length === 0 && !uploading && (
                <div className="empty-state">
                    <Plus size={40} />
                    <p>No assignments yet. Upload a file to get started.</p>
                </div>
            )}

            <div className="dashboard-grid">
                {assignments.map(card => (
                    <AssignmentCard
                        key={card.id}
                        assignment={card}
                        sessionId={sessionId}
                        onClick={setSelectedCard}
                    />
                ))}
            </div>

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
