import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { getAssignment, retryAssignment } from '../api';
import './AssignmentCard.css';

const SUBSTATUS = [
    'Reading assignment…',
    'Extracting requirements…',
    'Generating checklist…',
    'Preparing review view…',
];

const POLL_INTERVAL = 3000;

function AssignmentCard({ assignment: initial, sessionId, onClick }) {
    const [card, setCard] = useState(initial);
    const [substatusIdx, setSubstatusIdx] = useState(0);

    const isActive = card.processing_state === 'queued' || card.processing_state === 'processing';

    // Poll until ready/failed
    useEffect(() => {
        if (!isActive) return;
        const timer = setInterval(async () => {
            try {
                const updated = await getAssignment(card.id, sessionId);
                setCard(updated);
            } catch { /* silent */ }
        }, POLL_INTERVAL);
        return () => clearInterval(timer);
    }, [isActive, card.id, sessionId]);

    // Rotate substatus text while processing
    useEffect(() => {
        if (card.processing_state !== 'processing') return;
        const timer = setInterval(() => {
            setSubstatusIdx(i => (i + 1) % SUBSTATUS.length);
        }, 2000);
        return () => clearInterval(timer);
    }, [card.processing_state]);

    const handleRetry = async (e) => {
        e.stopPropagation();
        try {
            const updated = await retryAssignment(card.id, sessionId);
            setCard(updated);
        } catch { /* silent */ }
    };

    return (
        <div
            className={`assignment-card state-${card.processing_state}`}
            onClick={() => card.processing_state === 'ready' && onClick(card)}
        >
            {/* Processing / Queued states */}
            {(card.processing_state === 'queued' || card.processing_state === 'processing') && (
                <div className="card-processing">
                    <Loader2 size={20} className="spin" />
                    <div className="card-filename">{card.filename}</div>
                    <div className="card-substatus">
                        {card.processing_state === 'queued' ? 'Queued…' : SUBSTATUS[substatusIdx]}
                    </div>
                    <div className="progress-bar">
                        <div className="progress-fill indeterminate" />
                    </div>
                    <span className="state-badge processing">Processing</span>
                </div>
            )}

            {/* Ready state */}
            {card.processing_state === 'ready' && (
                <div className="card-ready">
                    <div className="card-header-row">
                        <span className="state-badge ready">Ready</span>
                        {card.due_date && <span className="due-date">Due {card.due_date}</span>}
                    </div>
                    <h3 className="card-title">{card.title || card.filename}</h3>
                    {card.module && <p className="card-module">{card.module}</p>}
                    <div className="card-meta">
                        {card.weightage && <span>{card.weightage}</span>}
                        {card.assignment_type && <span>{card.assignment_type}</span>}
                    </div>
                    {card.summary?.[0] && (
                        <p className="card-preview">{card.summary[0]}</p>
                    )}
                </div>
            )}

            {/* Failed state */}
            {card.processing_state === 'failed' && (
                <div className="card-failed">
                    <AlertCircle size={20} />
                    <div className="card-filename">{card.filename}</div>
                    <p className="error-msg">Processing failed</p>
                    <button className="retry-btn" onClick={handleRetry}>Retry</button>
                </div>
            )}
        </div>
    );
}

export default AssignmentCard;
