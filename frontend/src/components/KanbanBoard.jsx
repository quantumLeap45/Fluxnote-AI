import React, { useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import KanbanColumn from './KanbanColumn';
import AssignmentCard from './AssignmentCard';
import { updateAssignment } from '../api';
import './KanbanBoard.css';

const COLUMNS = ['todo', 'doing', 'done'];

function DraggableCard({ assignment, sessionId, onCardClick, onDeleteCard }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: assignment.id,
        data: { column: assignment.kanban_column || 'todo' },
    });

    const style = transform
        ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
        : undefined;

    return (
        <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
            <AssignmentCard
                assignment={assignment}
                sessionId={sessionId}
                onClick={onCardClick}
                onDelete={onDeleteCard}
            />
        </div>
    );
}

function KanbanBoard({ assignments, sessionId, onCardClick, onAssignmentUpdate, onDeleteCard }) {
    const [activeCard, setActiveCard] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    const grouped = COLUMNS.reduce((acc, col) => {
        acc[col] = assignments.filter(a => (a.kanban_column || 'todo') === col);
        return acc;
    }, {});

    const handleDragStart = ({ active }) => {
        setActiveCard(assignments.find(a => a.id === active.id) || null);
    };

    const handleDragEnd = async ({ active, over }) => {
        setActiveCard(null);
        if (!over || !COLUMNS.includes(over.id)) return;

        const targetColumn = over.id;
        const card = assignments.find(a => a.id === active.id);
        if (!card || (card.kanban_column || 'todo') === targetColumn) return;

        // Optimistic local update
        onAssignmentUpdate({ ...card, kanban_column: targetColumn });

        try {
            const updated = await updateAssignment(card.id, { kanban_column: targetColumn }, sessionId);
            onAssignmentUpdate(updated);
        } catch {
            // Revert on failure
            onAssignmentUpdate(card);
        }
    };

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="kanban-board">
                {COLUMNS.map(col => (
                    <KanbanColumn key={col} columnId={col} count={grouped[col].length}>
                        {grouped[col].map(card => (
                            <DraggableCard
                                key={card.id}
                                assignment={card}
                                sessionId={sessionId}
                                onCardClick={onCardClick}
                                onDeleteCard={onDeleteCard}
                            />
                        ))}
                    </KanbanColumn>
                ))}
            </div>

            <DragOverlay>
                {activeCard && (
                    <div style={{ opacity: 0.9, cursor: 'grabbing' }}>
                        <AssignmentCard
                            assignment={activeCard}
                            sessionId={sessionId}
                            onClick={() => {}}
                        />
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    );
}

export default KanbanBoard;
