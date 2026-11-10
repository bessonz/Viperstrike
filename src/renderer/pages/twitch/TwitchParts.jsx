import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { errorText, invoke, useApp, usePolled } from '../../lib.jsx';

// Twitch's glitch mark, drawn here so it follows the skin's colours.
export function TwitchMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.3 3 3 6.4V20h4.6v2.5h2.6l2.5-2.5h3.7l5-5V3H4.3Zm15 11.1-2.9 2.9h-4.6l-2.5 2.5V17H5.5V4.8h13.8v9.3Z" />
      <path d="M15.5 7.8h1.8v5.1h-1.8V7.8Zm-4.8 0h1.8v5.1h-1.8V7.8Z" />
    </svg>
  );
}

export function YouTubeMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.5 7.2a2.8 2.8 0 0 0-2-2C18.8 4.7 12 4.7 12 4.7s-6.8 0-8.5.5a2.8 2.8 0 0 0-2 2C1 8.9 1 12 1 12s0 3.1.5 4.8a2.8 2.8 0 0 0 2 2c1.7.5 8.5.5 8.5.5s6.8 0 8.5-.5a2.8 2.8 0 0 0 2-2c.5-1.7.5-4.8.5-4.8s0-3.1-.5-4.8ZM9.8 15.3V8.7l5.7 3.3-5.7 3.3Z" />
    </svg>
  );
}

export function useServiceStatus(platform) {
  const [status, refresh, setStatus] = usePolled(`${platform}:status`, 0);
  useEffect(() => window.vs.on(`${platform}:status`, setStatus), [platform, setStatus]);
  return [status, refresh];
}

export function YouTubeSetup({ onChange }) {
  const { settings, update, notify } = useApp();
  const [clientId, setClientId] = useState(settings.youtubeClientId);
  const [secret, setSecret] = useState(settings.youtubeClientSecret);
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try {
      await update({ youtubeClientId: clientId.trim(), youtubeClientSecret: secret.trim() });
      await invoke('youtube:connect');
      if (onChange) await onChange();
      notify('YouTube connected');
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ol className="setup-steps">
      <li>
        <div>
          <strong>Turn on the YouTube API in a free Google Cloud project</strong>
          <p>Google requires each person to use their own project. Create one, then enable YouTube Data API v3.</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => invoke('app:open-link', 'googleApi')}><ExternalLink size={14} /> Open YouTube API page</button>
      </li>
      <li>
        <div>
          <strong>Create a sign-in client</strong>
          <p>Under Credentials, set up the consent screen as External, then create an OAuth client of type Desktop app. Publish the consent screen to production; in testing mode, Google signs you out every 7 days. You'll see an "unverified app" warning for your own project, which is expected.</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => invoke('app:open-link', 'googleClients')}><ExternalLink size={14} /> Open Credentials</button>
      </li>
      <li>
        <div className="setup-stack">
          <label htmlFor="yt-client-id"><strong>Paste the Client ID and secret</strong></label>
          <input id="yt-client-id" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" spellCheck={false} />
          <input className="input" aria-label="Client secret" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Client secret" spellCheck={false} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={!clientId.trim() || busy} onClick={connect}>{busy ? 'Waiting for your browser' : 'Connect YouTube'}</button>
      </li>
    </ol>
  );
}

export function TwitchSetup({ status }) {
  const { settings, update, notify } = useApp();
  const [clientId, setClientId] = useState(settings.twitchClientId);
  const [busy, setBusy] = useState(false);

  useEffect(() => window.vs.on('twitch:connect-error', (message) => notify(message, 'error')), [notify]);

  const connect = async () => {
    setBusy(true);
    try {
      await update({ twitchClientId: clientId.trim() });
      await invoke('twitch:connect');
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (status?.pending) {
    return (
      <div className="twitch-code">
        <p>Your browser opened Twitch's activation page. Confirm this code there, and this page updates by itself.</p>
        <strong className="twitch-code-value">{status.pending.userCode}</strong>
        <div className="twitch-code-actions">
          <button className="btn btn-primary btn-sm" onClick={() => invoke('twitch:open-activation')}><ExternalLink size={14} /> Open activation page</button>
          <button className="btn btn-ghost btn-sm" onClick={() => invoke('twitch:cancel-connect')}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <ol className="setup-steps">
      <li>
        <div>
          <strong>Register a free Twitch app</strong>
          <p>Twitch requires each person to register their own, and asks for two-factor sign-in on your account. Name it anything, set the OAuth Redirect URL to http://localhost:3000, the Category to Application Integration, and the Client Type to Public.</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => invoke('app:open-link', 'twitchConsole')}><ExternalLink size={14} /> Open Twitch console</button>
      </li>
      <li>
        <div className="setup-field">
          <label htmlFor="twitch-client-id"><strong>Paste the app's Client ID</strong></label>
          <input id="twitch-client-id" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="30-character Client ID" spellCheck={false} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={!clientId.trim() || busy} onClick={connect}>{busy ? 'Contacting Twitch' : 'Connect Twitch'}</button>
      </li>
    </ol>
  );
}

export const uptime = (startedAt) => {
  if (!startedAt) return '';
  const min = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
};

export const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown');

export const modAction = (notify, action, payload, done) => chatMod(notify, 'twitch', action, payload, done);

export function chatMod(notify, source, action, payload, done) {
  return invoke(`${source}:mod`, action, payload).then((entry) => {
    if (done) notify(done);
    return entry;
  }).catch((err) => {
    notify(errorText(err), 'error');
    throw err;
  });
}
