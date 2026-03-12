import { useState } from 'react';
import './OnboardingModal.css';

const SLIDES = [
    {
        step: '1 of 2',
        title: 'Welcome to Fluxnote',
        body: "Your AI workspace — no account needed. Chat with AI, upload your documents, and track everything on a board. Let's show you the two main areas.",
        cta: 'Next →',
    },
    {
        step: '2 of 2',
        title: 'Two things to know',
        body: null,
        cta: 'Get Started →',
    },
];

function OnboardingModal({ onComplete }) {
    const [slide, setSlide] = useState(0);

    const handleNext = () => {
        if (slide < SLIDES.length - 1) setSlide(slide + 1);
        else onComplete();
    };

    return (
        <div className="onboarding-overlay">
            <div className="onboarding-modal">
                <div className="onboarding-header">
                    <span className="onboarding-step">{SLIDES[slide].step}</span>
                    <button className="onboarding-skip" onClick={onComplete}>Skip</button>
                </div>

                <h2 className="onboarding-title">{SLIDES[slide].title}</h2>

                {slide === 0 && (
                    <p className="onboarding-body">{SLIDES[slide].body}</p>
                )}

                {slide === 1 && (
                    <div className="onboarding-panels">
                        <div className="onboarding-panel">
                            <span className="onboarding-panel-icon">💬</span>
                            <strong>Chat</strong>
                            <p>Ask AI anything. Upload files directly in the chat for instant analysis.</p>
                        </div>
                        <div className="onboarding-panel">
                            <span className="onboarding-panel-icon">📋</span>
                            <strong>Dashboard</strong>
                            <p>Upload a doc in Chat and it becomes a card here — with summary, due date, and progress tracking.</p>
                        </div>
                    </div>
                )}

                <div className="onboarding-footer">
                    <button className="onboarding-cta" onClick={handleNext}>
                        {SLIDES[slide].cta}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default OnboardingModal;
