import React from 'react';
import { useDroppable } from '@dnd-kit/core';

const COLUMN_LABELS = {
    todo:  'To-Do',
    doing: 'Currently Doing',
    done:  'Completed',
};

const COLUMN_ACCENTS = {
    todo:  'var(--text-secondary)',
    doing: 'var(--accent-color)',
    done:  '#34c759',
};

function KanbanColumn({ columnId, children, count, footer }) {
    const { isOver, setNodeRef } = useDroppable({ id: columnId });

    return (
        <div
            ref={setNodeRef}
            className={`kanban-column ${isOver ? 'kanban-column-over' : ''}`}
            data-column={columnId}
        >
            <div className="kanban-column-header">
                <span
                    className="kanban-column-title"
                    style={{ color: COLUMN_ACCENTS[columnId] }}
                >
                    {COLUMN_LABELS[columnId]}
                </span>
                <span className="kanban-column-count">{count}</span>
            </div>
            <div className="kanban-column-body">
                {count === 0 && (
                    <div className="kanban-column-empty">No cards here yet</div>
                )}
                {children}
            </div>
            {footer && <div className="kanban-column-footer">{footer}</div>}
        </div>
    );
}

export default KanbanColumn;
