import { useState } from 'react';
import './HintBanner.css';

function HintBanner({ message, onDismiss, storageKey }) {
    const [visible, setVisible] = useState(
        () => !localStorage.getItem(storageKey)
    );

    const dismiss = () => {
        localStorage.setItem(storageKey, '1');
        setVisible(false);
        if (onDismiss) onDismiss();
    };

    if (!visible) return null;

    return (
        <div className="hint-banner">
            <span className="hint-icon">✦</span>
            <span className="hint-message">{message}</span>
            <button className="hint-dismiss" onClick={dismiss} aria-label="Dismiss">✕</button>
        </div>
    );
}

export default HintBanner;
