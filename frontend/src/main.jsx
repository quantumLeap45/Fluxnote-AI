import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LandingPage from './components/LandingPage.jsx'

const LANDING_KEY = 'fluxnote_seen_landing';
const WORKSPACE_KEY = 'fluxnote_workspace_id'; // set for all existing users

function Root() {
    const isReturning = () =>
        !!localStorage.getItem(LANDING_KEY) ||
        !!localStorage.getItem(WORKSPACE_KEY);

    const [showApp, setShowApp] = useState(isReturning);

    const handleEnter = () => {
        localStorage.setItem(LANDING_KEY, '1');
        setShowApp(true);
    };

    return showApp
        ? <App />
        : <LandingPage onEnter={handleEnter} />;
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <Root />
    </StrictMode>,
)
