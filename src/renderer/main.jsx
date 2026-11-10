import { createRoot } from 'react-dom/client';
import './tokens.css';
import './styles.css';
import { App } from './App.jsx';
import { MiniApp, PopoutApp } from './windows.jsx';
import { AlertsApp } from './alerts/AlertsApp.jsx';

// The same page serves the main window, pop-out chat, the mini player's toolbar and the Alerts window.
const route = window.location.hash.slice(1);
const Root = route === 'popout-chat' ? PopoutApp : route === 'mini' ? MiniApp : route === 'alerts' ? AlertsApp : App;
createRoot(document.getElementById('root')).render(<Root />);
