import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { X, MessageSquare, CheckSquare, Square, Sparkles, RefreshCw } from 'lucide-react';
import './AssignmentDetail.css';
import { reExtractAssignment } from '../api';

function AssignmentDetail({ assignment: initial, sessionId, onClose, onAskAI }) {
    const [localCard, setLocalCard] = useState(initial);
    const checklistKey = `fluxnote_checklist_${initial.id}`;
    const [checkedItems, setCheckedItems] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem(checklistKey) || '[]')); }
        catch { return new Set(); }
    });

    const CURRENT_VERSION = 2;
    const dismissKey = `fluxnote_dismissed_upgrade_${localCard.id}`;
    const isOldCard = (localCard.extraction_version || 1) < CURRENT_VERSION;
    const alreadyDismissed = localStorage.getItem(dismissKey) === 'true';
    const [showBanner, setShowBanner] = useState(isOldCard && !alreadyDismissed);
    const [reExtracting, setReExtracting] = useState(false);

    const toggleCheck = (item) => {
        setCheckedItems(prev => {
            const next = new Set(prev);
            next.has(item) ? next.delete(item) : next.add(item);
            localStorage.setItem(checklistKey, JSON.stringify([...next]));
            return next;
        });
    };

    const handleKeepCurrent = () => {
        localStorage.setItem(dismissKey, 'true');
        setShowBanner(false);
    };

    const handleReExtract = async () => {
        setReExtracting(true);
        try {
            const updated = await reExtractAssignment(localCard.id, sessionId);
            setLocalCard(updated);
            localStorage.setItem(dismissKey, 'true');
            setShowBanner(false);
        } catch (err) {
            console.error('Re-extraction failed:', err);
        } finally {
            setReExtracting(false);
        }
    };

    return (
        <div className="detail-overlay" onClick={onClose}>
            <div className="detail-modal" onClick={e => e.stopPropagation()}>
                <button className="detail-close" onClick={onClose}>
                    <X size={20} />
                </button>

                {/* Upgrade Banner */}
                {showBanner && (
                    <div className="upgrade-banner">
                        <Sparkles size={15} className="upgrade-icon" />
                        <span>We've improved the analysis for this assignment.</span>
                        <div className="upgrade-actions">
                            <button
                                className="upgrade-btn-refresh"
                                onClick={handleReExtract}
                                disabled={reExtracting}
                            >
                                <RefreshCw size={13} />
                                {reExtracting ? 'Updating…' : 'Refresh analysis'}
                            </button>
                            <button className="upgrade-btn-keep" onClick={handleKeepCurrent}>
                                Keep current
                            </button>
                        </div>
                    </div>
                )}

                {/* Header */}
                <div className="detail-header">
                    <span className="state-badge ready">Ready</span>
                    {localCard.due_date && <span className="due-date">Due {localCard.due_date}</span>}
                    {localCard.weightage && <span className="weightage">{localCard.weightage}</span>}
                    {localCard.assignment_type && <span className="atype">{localCard.assignment_type}</span>}
                </div>

                <h2 className="detail-title">{localCard.title || localCard.filename}</h2>
                {localCard.module && <p className="detail-module">{localCard.module}</p>}

                {/* Summary */}
                {localCard.summary?.length > 0 && (
                    <section className="detail-section">
                        <h4>Summary</h4>
                        <ul>
                            {localCard.summary.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                    </section>
                )}

                {/* Checklist */}
                {localCard.checklist?.length > 0 && (
                    <section className="detail-section">
                        <h4>Checklist</h4>
                        {localCard.checklist.map((item, i) => (
                            <div key={i} className="checklist-item" onClick={() => toggleCheck(item)}>
                                {checkedItems.has(item)
                                    ? <CheckSquare size={16} className="checked" />
                                    : <Square size={16} />
                                }
                                <span className={checkedItems.has(item) ? 'item-done' : ''}>{item}</span>
                            </div>
                        ))}
                    </section>
                )}

                {/* Constraints */}
                {localCard.constraints && (
                    <section className="detail-section">
                        <h4>Requirements & Constraints</h4>
                        <ReactMarkdown className="constraints-md">{localCard.constraints}</ReactMarkdown>
                    </section>
                )}

                {/* Source file(s) */}
                <section className="detail-section">
                    <h4>Source {localCard.file_ids?.length > 1 ? 'Files' : 'File'}</h4>
                    <p className="source-file">{localCard.filename}</p>
                    {localCard.file_ids?.length > 1 && (
                        <p className="source-file-extra">
                            +{localCard.file_ids.length - 1} additional file{localCard.file_ids.length > 2 ? 's' : ''} included
                        </p>
                    )}
                </section>

                {/* Ask AI */}
                <button className="ask-ai-btn" onClick={() => onAskAI(localCard)}>
                    <MessageSquare size={16} />
                    Ask AI about this assignment
                </button>
            </div>
        </div>
    );
}

export default AssignmentDetail;
