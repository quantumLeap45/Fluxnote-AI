import React, { useState, useRef } from 'react';
import { X, FileText, Plus, Loader2 } from 'lucide-react';
import {
    uploadToStorage,
    processStorageFile,
    uploadFile,
    createAssignment,
    createAssignmentMulti,
} from '../api';
import './CardCreationPanel.css';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const ALLOWED_EXTS      = ['pdf', 'docx', 'txt', 'csv', 'pptx'];
const MAX_FILES         = 3;

function CardCreationPanel({ sessionId, onCardCreated, onCancel }) {
    const [files, setFiles]       = useState([]);
    const [dragging, setDragging] = useState(false);
    const [creating, setCreating] = useState(false);
    const [error, setError]       = useState(null);
    const inputRef = useRef();

    const getExt = (name) => name.split('.').pop()?.toLowerCase() || '';

    const addFiles = (incoming) => {
        const valid   = incoming.filter(f => ALLOWED_EXTS.includes(getExt(f.name)));
        const skipped = incoming.length - valid.length;
        if (skipped > 0) setError(`${skipped} file(s) skipped — only PDF, DOCX, TXT, CSV, PPTX allowed.`);
        setFiles(prev => [...prev, ...valid].slice(0, MAX_FILES));
    };

    const removeFile = (idx) => {
        setFiles(prev => prev.filter((_, i) => i !== idx));
        setError(null);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
    };

    const handleCreate = async () => {
        if (!files.length || creating) return;
        setCreating(true);
        setError(null);

        try {
            const fileIds = [];
            const useStorage = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

            for (const file of files) {
                let record;
                if (useStorage) {
                    const { path } = await uploadToStorage(file, sessionId);
                    record = await processStorageFile(path, file.name, sessionId);
                } else {
                    record = await uploadFile(file, sessionId);
                }
                fileIds.push(record.id);
            }

            const card = fileIds.length === 1
                ? await createAssignment(fileIds[0], sessionId)
                : await createAssignmentMulti(fileIds, sessionId);

            onCardCreated({ ...card, kanban_column: 'todo' });
        } catch (err) {
            setError(err.message);
            setCreating(false);
        }
    };

    return (
        <div className="card-creation-panel">
            {/* Drop zone — only shown when under file limit */}
            {files.length < MAX_FILES && (
                <div
                    className={`creation-drop-zone ${dragging ? 'dragging' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                >
                    <Plus size={13} />
                    <span>Drop files or click to browse</span>
                    <span className="creation-limit">{files.length}/{MAX_FILES}</span>
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        accept=".pdf,.docx,.txt,.csv,.pptx"
                        style={{ display: 'none' }}
                        onChange={(e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; }}
                    />
                </div>
            )}

            {/* Selected files */}
            {files.length > 0 && (
                <div className="creation-file-list">
                    {files.map((f, i) => (
                        <div key={i} className="creation-file-item">
                            <FileText size={11} />
                            <span className="creation-file-name">{f.name}</span>
                            <button
                                className="creation-file-remove"
                                onClick={() => removeFile(i)}
                                disabled={creating}
                            >
                                <X size={11} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {error && <p className="creation-error">{error}</p>}

            <div className="creation-actions">
                <button className="creation-cancel-btn" onClick={onCancel} disabled={creating}>
                    Cancel
                </button>
                <button
                    className="creation-create-btn"
                    onClick={handleCreate}
                    disabled={!files.length || creating}
                >
                    {creating
                        ? <><Loader2 size={12} className="spin" /> Creating…</>
                        : 'Create Card'}
                </button>
            </div>
        </div>
    );
}

export default CardCreationPanel;
