import React, { useState } from 'react';
import { X, MessageSquare, CheckSquare, Square } from 'lucide-react';
import './AssignmentDetail.css';

function AssignmentDetail({ assignment: initial, sessionId, onClose, onAskAI }) {
    const [card] = useState(initial);
    const [checkedItems, setCheckedItems] = useState(new Set());

    const toggleCheck = (item) => {
        setCheckedItems(prev => {
            const next = new Set(prev);
            next.has(item) ? next.delete(item) : next.add(item);
            return next;
        });
    };

    return (
        <div className="detail-overlay" onClick={onClose}>
            <div className="detail-modal" onClick={e => e.stopPropagation()}>
                <button className="detail-close" onClick={onClose}>
                    <X size={20} />
                </button>

                {/* Header */}
                <div className="detail-header">
                    <span className="state-badge ready">Ready</span>
                    {card.due_date && <span className="due-date">Due {card.due_date}</span>}
                    {card.weightage && <span className="weightage">{card.weightage}</span>}
                    {card.assignment_type && <span className="atype">{card.assignment_type}</span>}
                </div>

                <h2 className="detail-title">{card.title || card.filename}</h2>
                {card.module && <p className="detail-module">{card.module}</p>}

                {/* Summary */}
                {card.summary?.length > 0 && (
                    <section className="detail-section">
                        <h4>Summary</h4>
                        <ul>
                            {card.summary.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                    </section>
                )}

                {/* Checklist */}
                {card.checklist?.length > 0 && (
                    <section className="detail-section">
                        <h4>Checklist</h4>
                        {card.checklist.map((item, i) => (
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
                {card.constraints && (
                    <section className="detail-section">
                        <h4>Requirements & Constraints</h4>
                        <p>{card.constraints}</p>
                    </section>
                )}

                {/* Source file */}
                <section className="detail-section">
                    <h4>Source File</h4>
                    <p className="source-file">{card.filename}</p>
                </section>

                {/* Ask AI */}
                <button className="ask-ai-btn" onClick={() => onAskAI(card)}>
                    <MessageSquare size={16} />
                    Ask AI about this assignment
                </button>
            </div>
        </div>
    );
}

export default AssignmentDetail;
