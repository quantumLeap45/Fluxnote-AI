import { useEffect } from 'react';
import './LandingPage.css';

function LandingPage({ onEnter }) {
    useEffect(() => {
        document.documentElement.style.overflowY = 'auto';
        return () => { document.documentElement.style.overflowY = ''; };
    }, []);

    return (
        <div className="landing-root">
            <nav className="landing-nav">
                <span className="landing-logo">Fluxnote</span>
                <button className="landing-nav-cta" onClick={onEnter}>Open Fluxnote →</button>
            </nav>

            <section className="landing-hero">
                <h1 className="landing-headline">
                    Your AI workspace —<br />
                    chat, organize, and get things done.
                </h1>
                <p className="landing-subheadline">
                    Upload docs, track your work on a board, and ask AI anything —
                    all in one place. No account needed.
                </p>
                <button className="landing-cta-primary" onClick={onEnter}>
                    Open Fluxnote →
                </button>
            </section>

            <section className="landing-features">
                <div className="feature-card">
                    <span className="feature-icon">💬</span>
                    <h3>Chat with AI</h3>
                    <p>Ask anything. Fluxnote knows your documents and your board, so answers are always in context.</p>
                </div>
                <div className="feature-card">
                    <span className="feature-icon">📎</span>
                    <h3>Upload Documents</h3>
                    <p>Drag in PDFs, notes, or files. Fluxnote reads them and extracts the important details automatically.</p>
                </div>
                <div className="feature-card">
                    <span className="feature-icon">📋</span>
                    <h3>Track Your Work</h3>
                    <p>Every uploaded doc becomes a card on your board — with title, due date, summary, and progress tracking.</p>
                </div>
            </section>

            <footer className="landing-footer">
                <p>Fluxnote · Your AI workspace · 2026</p>
            </footer>
        </div>
    );
}

export default LandingPage;
