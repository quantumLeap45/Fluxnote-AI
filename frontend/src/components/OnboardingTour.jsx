import { useState, useEffect, useCallback } from 'react';
import Joyride, { ACTIONS, EVENTS, STATUS } from 'react-joyride';

// Step definitions — targets use data-tour attributes added to real UI elements
function buildSteps() {
    return [
        // Step 0 — Welcome (centred, no target)
        {
            target: 'body',
            placement: 'center',
            disableBeacon: true,
            title: 'Welcome to Fluxnote 👋',
            content: (
                <p>
                    Your AI workspace — no account needed. Chat with AI, upload
                    documents, and track everything on a board. Let&apos;s take a
                    30-second tour.
                </p>
            ),
        },
        // Step 1 — Chat input (interactive — spotlight clicks enabled)
        {
            target: '[data-tour="chat-input"]',
            placement: 'top',
            disableBeacon: true,
            spotlightClicks: true,
            title: 'Start a conversation',
            content: (
                <p>
                    Type any question here — Fluxnote AI knows your documents and
                    your board, so answers are always in context. Try typing
                    something now, or click <strong>Next</strong> to continue.
                </p>
            ),
        },
        // Step 2 — File upload
        {
            target: '[data-tour="file-upload"]',
            placement: 'top',
            disableBeacon: true,
            spotlightClicks: true,
            title: 'Attach files',
            content: (
                <p>
                    Click the paperclip to upload PDFs, Word docs, or text files.
                    You can attach up to <strong>5 files</strong> per chat session —
                    Fluxnote reads them and makes every detail available instantly.
                </p>
            ),
        },
        // Step 3 — Model selector
        {
            target: '[data-tour="model-selector"]',
            placement: 'bottom',
            disableBeacon: true,
            spotlightClicks: true,
            title: 'Choose your AI mode',
            content: (
                <div>
                    <p style={{ marginBottom: 10 }}>Pick the right AI for the job:</p>
                    <p style={{ marginBottom: 6 }}>
                        ⚡ <strong>Fast</strong> — instant answers for quick questions
                    </p>
                    <p style={{ marginBottom: 6 }}>
                        ⚖️ <strong>Balanced</strong> — more thorough, detailed responses
                    </p>
                    <p style={{ marginBottom: 6 }}>
                        🧠 <strong>Deep Think</strong> — complex problems with step-by-step reasoning
                    </p>
                    <p>
                        🔀 <strong>Routed</strong> — AI automatically picks the best model for you
                    </p>
                </div>
            ),
        },
        // Step 4 — Dashboard tab (interactive — click to navigate)
        {
            target: '[data-tour="dashboard-tab"]',
            placement: 'right',
            disableBeacon: true,
            spotlightClicks: true,
            title: 'Your Dashboard',
            content: (
                <p>
                    Every file you upload becomes a card here — with title, due
                    date, summary, and progress tracking on a Kanban board.{' '}
                    <strong>Click Dashboard</strong> to explore, or press{' '}
                    <strong>Next</strong> to continue.
                </p>
            ),
        },
        // Step 5 — Finish (centred, no target)
        {
            target: 'body',
            placement: 'center',
            disableBeacon: true,
            title: "You're all set! 🚀",
            content: (
                <p>
                    Start chatting, upload a file, or explore the dashboard. Click
                    the <strong>? Help</strong> button in the sidebar any time to
                    replay this tour.
                </p>
            ),
        },
    ];
}

function OnboardingTour({ run, theme, onComplete, setActiveTab }) {
    const [stepIndex, setStepIndex] = useState(0);
    const steps = buildSteps();

    // Reset step index whenever the tour is re-opened
    useEffect(() => {
        if (run) setStepIndex(0);
    }, [run]);

    // Step 1 (chat input): advance tour on first keypress in the textarea
    useEffect(() => {
        if (!run || stepIndex !== 1) return;
        const textarea = document.querySelector('[data-tour="chat-input"] textarea');
        if (!textarea) return;
        const handler = () => setStepIndex(2);
        textarea.addEventListener('keypress', handler, { once: true });
        return () => textarea.removeEventListener('keypress', handler);
    }, [run, stepIndex]);

    // Step 4 (dashboard tab): advance tour when user clicks the tab
    useEffect(() => {
        if (!run || stepIndex !== 4) return;
        const tab = document.querySelector('[data-tour="dashboard-tab"]');
        if (!tab) return;
        const handler = () => {
            setActiveTab('dashboard');
            setStepIndex(5);
        };
        tab.addEventListener('click', handler, { once: true });
        return () => tab.removeEventListener('click', handler);
    }, [run, stepIndex, setActiveTab]);

    const handleCallback = useCallback(({ action, status, type }) => {
        // Tour ended (finished or skipped by any means)
        if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
            onComplete();
            return;
        }

        if (type === EVENTS.STEP_AFTER) {
            if (action === ACTIONS.NEXT) {
                setStepIndex(i => i + 1);
            } else if (action === ACTIONS.PREV) {
                setStepIndex(i => Math.max(0, i - 1));
            } else if (action === ACTIONS.CLOSE) {
                onComplete();
            }
        }

        // If a target element is not in the DOM, skip to next step
        if (type === EVENTS.TARGET_NOT_FOUND) {
            setStepIndex(i => i + 1);
        }
    }, [onComplete]);

    // Theme-aware tooltip colours
    const isDark = theme === 'dark';
    const joyrideStyles = {
        options: {
            primaryColor: isDark ? '#0a84ff' : '#007aff',
            backgroundColor: isDark ? '#252526' : '#ffffff',
            textColor: isDark ? '#f5f5f7' : '#1d1d1f',
            arrowColor: isDark ? '#252526' : '#ffffff',
            overlayColor: 'rgba(0, 0, 0, 0.55)',
            zIndex: 10000,
        },
        tooltip: {
            borderRadius: '16px',
            padding: '24px 28px',
            boxShadow: isDark
                ? '0 12px 24px rgba(0,0,0,0.5)'
                : '0 12px 24px rgba(0,0,0,0.12)',
        },
        tooltipTitle: {
            fontSize: '17px',
            fontWeight: 600,
            marginBottom: '8px',
            color: isDark ? '#f5f5f7' : '#1d1d1f',
        },
        tooltipContent: {
            fontSize: '14px',
            lineHeight: 1.65,
            padding: '4px 0 8px',
            color: isDark ? '#a1a1a6' : '#3a3a3c',
        },
        buttonNext: {
            backgroundColor: isDark ? '#0a84ff' : '#007aff',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            padding: '8px 16px',
            color: '#fff',
        },
        buttonBack: {
            color: isDark ? '#a1a1a6' : '#86868b',
            fontSize: '13px',
            marginRight: '8px',
        },
        buttonSkip: {
            color: isDark ? '#a1a1a6' : '#86868b',
            fontSize: '12px',
        },
        spotlight: {
            borderRadius: '10px',
        },
    };

    return (
        <Joyride
            steps={steps}
            run={run}
            stepIndex={stepIndex}
            continuous
            showSkipButton
            showProgress
            disableScrolling={false}
            disableOverlayClose={false}
            callback={handleCallback}
            styles={joyrideStyles}
            locale={{
                last: 'Get Started →',
                skip: 'Skip tour',
                next: 'Next →',
                back: '← Back',
                close: 'Close',
            }}
            floaterProps={{
                disableAnimation: false,
            }}
        />
    );
}

export default OnboardingTour;
