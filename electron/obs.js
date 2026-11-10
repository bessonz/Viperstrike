// OBS, through the WebSocket server built into OBS 28 and newer (Tools, then WebSocket Server Settings).
// Shows whether OBS is streaming or recording, its scenes, and whether the Viperstrike overlay is in it.
const crypto = require('crypto');
const { safeStorage } = require('electron');

const RETRY_MS = 5000;
const REQUEST_TIMEOUT_MS = 8000;
// General, Scenes, Inputs, Transitions, Outputs, Scene items and UI (studio mode) events.
const EVENTS = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 10);
// Audio meters arrive many times a second, so they're only asked for while the OBS page is open.
const METERS = 1 << 16;
// What the OBS page may ask OBS to do. Anything else is refused.
const PAGE_REQUESTS = new Set([
  'GetVersion', 'GetStats', 'GetVideoSettings', 'GetSceneList', 'GetSceneItemList', 'GetGroupSceneItemList', 'GetInputList', 'GetInputKindList', 'GetSpecialInputs',
  'GetInputVolume', 'GetInputMute', 'GetInputAudioMonitorType', 'GetSceneTransitionList', 'GetCurrentSceneTransition', 'GetStudioModeEnabled', 'GetCurrentPreviewScene',
  'GetStreamStatus', 'GetRecordStatus', 'GetVirtualCamStatus', 'GetReplayBufferStatus', 'GetSourceScreenshot',
  'SetCurrentProgramScene', 'SetCurrentPreviewScene', 'CreateScene', 'RemoveScene', 'SetSceneName',
  'SetSceneItemEnabled', 'SetSceneItemLocked', 'SetSceneItemIndex', 'RemoveSceneItem', 'CreateInput', 'SetInputName', 'CreateSceneItem',
  'SetInputVolume', 'SetInputMute', 'ToggleInputMute', 'SetInputAudioMonitorType',
  'OpenInputPropertiesDialog', 'OpenInputFiltersDialog', 'OpenInputInteractDialog', 'OpenSourceProjector', 'OpenVideoMixProjector', 'PressInputPropertiesButton',
  'SetCurrentSceneTransition', 'SetCurrentSceneTransitionDuration', 'TriggerStudioModeTransition', 'SetStudioModeEnabled',
  'StartStream', 'StopStream', 'StartRecord', 'StopRecord', 'PauseRecord', 'ResumeRecord', 'StartVirtualCam', 'StopVirtualCam',
  'StartReplayBuffer', 'StopReplayBuffer', 'SaveReplayBuffer',
]);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('base64');

class Obs {
  constructor({ getSettings, saveSettings, broadcast, getOverlayUrl, onStreaming }) {
    Object.assign(this, { getSettings, saveSettings, broadcast, getOverlayUrl, onStreaming });
    this.socket = null;
    this.pending = new Map();
    this.state = { status: 'off' };
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.broadcast('obs:state', this.state);
  }

  start() {
    if (this.getSettings().obsEnabled) this.connect();
  }

  stop() {
    clearTimeout(this.retry);
    this.closing = true;
    try { this.socket?.close(); } catch { /* already closed */ }
  }

  async password() {
    const enc = this.getSettings().obsPassword;
    if (!enc) return '';
    try { return (await safeStorage.decryptStringAsync(Buffer.from(enc, 'base64'))).result; } catch { return ''; }
  }

  async configure({ host, port, password, enabled }) {
    const patch = {};
    if (host !== undefined) patch.obsHost = String(host).trim() || '127.0.0.1';
    if (port !== undefined) patch.obsPort = Math.max(1, Math.min(65535, Number(port) || 4455));
    if (password !== undefined) patch.obsPassword = password ? (await safeStorage.encryptStringAsync(String(password))).toString('base64') : '';
    if (enabled !== undefined) patch.obsEnabled = !!enabled;
    this.saveSettings(patch);
    this.stop();
    this.closing = false;
    if (this.getSettings().obsEnabled) this.connect();
    else this.set({ status: 'off' });
    return this.state;
  }

  connect() {
    clearTimeout(this.retry);
    const { obsHost = '127.0.0.1', obsPort = 4455 } = this.getSettings();
    this.closing = false;
    if (this.state.status !== 'connected') this.set({ status: 'connecting' });
    let socket;
    try {
      socket = new WebSocket(`ws://${obsHost}:${obsPort}`);
    } catch {
      this.set({ status: 'error', message: "That OBS address isn't valid." });
      return;
    }
    this.socket = socket;
    socket.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)));
    socket.onerror = () => {};
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const { reject } of this.pending.values()) reject(new Error('OBS disconnected.'));
      this.pending.clear();
      if (this.closing) return;
      // 4009 is OBS saying the password was wrong. Trying again won't fix that.
      if (ev.code === 4009) { this.set({ status: 'auth', message: 'OBS turned down the password. Check it in OBS under Tools, WebSocket Server Settings.' }); return; }
      const wasConnected = this.state.status === 'connected';
      this.set({ status: 'waiting', message: wasConnected ? 'OBS closed. Waiting for it to open again.' : 'Waiting for OBS. Open OBS and turn on its WebSocket server.' });
      if (this.state.streaming) this.onStreaming?.(false);
      this.retry = setTimeout(() => this.connect(), RETRY_MS);
    };
  }

  async onMessage(msg) {
    const { op, d } = msg;
    if (op === 0) {
      const identify = { rpcVersion: 1, eventSubscriptions: this.subscriptions() };
      if (d.authentication) {
        const password = await this.password();
        identify.authentication = sha256(sha256(password + d.authentication.salt) + d.authentication.challenge);
      }
      this.socket?.send(JSON.stringify({ op: 1, d: identify }));
    } else if (op === 2) {
      this.set({ status: 'connected', message: '' });
      this.refresh().catch(() => {});
    } else if (op === 7) {
      const p = this.pending.get(d.requestId);
      if (!p) return;
      this.pending.delete(d.requestId);
      clearTimeout(p.timer);
      if (d.requestStatus?.result) p.resolve(d.responseData || {});
      else p.reject(new Error(d.requestStatus?.comment || 'OBS could not do that.'));
    } else if (op === 5) {
      this.onEvent(d.eventType, d.eventData || {});
    }
  }

  subscriptions() { return EVENTS | (this.meters ? METERS : 0); }

  // The OBS page turns the audio meters on while it's open, and off again when it closes.
  setMeters(on) {
    this.meters = !!on;
    if (this.socket && this.state.status === 'connected') this.socket.send(JSON.stringify({ op: 3, d: { eventSubscriptions: this.subscriptions() } }));
  }

  call(requestType, requestData) {
    if (!PAGE_REQUESTS.has(requestType)) return Promise.reject(new Error(`Viperstrike doesn't send ${requestType} to OBS.`));
    return this.request(requestType, requestData && typeof requestData === 'object' ? requestData : undefined);
  }

  request(requestType, requestData) {
    if (!this.socket || this.state.status !== 'connected') return Promise.reject(new Error('OBS is not connected.'));
    const requestId = crypto.randomBytes(6).toString('hex');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('OBS took too long to answer.')); }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } }));
    });
  }

  onEvent(type, data) {
    if (type === 'InputVolumeMeters') { this.broadcast('obs:meters', data.inputs || []); return; }
    this.broadcast('obs:event', { type, data });
    switch (type) {
      case 'CurrentProgramSceneChanged':
        this.set({ currentScene: data.sceneName });
        break;
      case 'SceneListChanged':
      case 'InputCreated':
      case 'InputRemoved':
      case 'InputSettingsChanged':
      case 'SceneItemCreated':
      case 'SceneItemRemoved':
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.refresh().catch(() => {}), 300);
        break;
      case 'StreamStateChanged':
        if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED' || data.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
          const streaming = !!data.outputActive;
          this.set({ streaming, streamStartedAt: streaming ? Date.now() : null });
          this.onStreaming?.(streaming);
        }
        break;
      case 'RecordStateChanged':
        if (data.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED' || data.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') this.set({ recording: !!data.outputActive });
        break;
      default:
        break;
    }
  }

  async refresh() {
    const [version, scenes, stream, record] = await Promise.all([
      this.request('GetVersion'),
      this.request('GetSceneList'),
      this.request('GetStreamStatus').catch(() => ({})),
      this.request('GetRecordStatus').catch(() => ({})),
    ]);
    const streaming = !!stream.outputActive;
    const wasStreaming = this.state.streaming;
    this.set({
      version: version.obsVersion,
      scenes: (scenes.scenes || []).map((s) => s.sceneName).reverse(), // OBS lists them bottom to top.
      currentScene: scenes.currentProgramSceneName,
      streaming,
      streamStartedAt: streaming ? Date.now() - (stream.outputDuration || 0) : null,
      recording: !!record.outputActive,
      overlay: await this.findOverlay().catch(() => null),
    });
    if (streaming !== !!wasStreaming) this.onStreaming?.(streaming);
  }

  // Looks through OBS's browser sources for one showing this PC's Viperstrike overlay.
  async findOverlay() {
    const url = this.getOverlayUrl();
    const base = url.split('?')[0];
    const token = new URL(url).searchParams.get('token');
    // Any port counts, so an overlay left on an old port (after it moved to a free one) can be fixed.
    const isOverlay = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/overlay\.html/i;
    const { inputs } = await this.request('GetInputList', { inputKind: 'browser_source' });
    for (const input of inputs || []) {
      const { inputSettings } = await this.request('GetInputSettings', { inputName: input.inputName });
      const src = String(inputSettings?.url || '');
      if (isOverlay.test(src)) return { name: input.inputName, current: src.startsWith(base) && src.includes(`token=${token}`) };
    }
    return null;
  }

  // Adds the overlay as a full-screen browser source to the scene that's showing, or fixes an old address.
  async addOverlay() {
    const url = this.getOverlayUrl();
    const found = this.state.overlay;
    if (found && !found.current) {
      await this.request('SetInputSettings', { inputName: found.name, inputSettings: { url } });
    } else if (!found) {
      await this.request('CreateInput', {
        sceneName: this.state.currentScene,
        inputName: 'Viperstrike overlay',
        inputKind: 'browser_source',
        inputSettings: { url, width: 1920, height: 1080, reroute_audio: true, shutdown: false },
        sceneItemEnabled: true,
      });
    }
    await this.refresh();
    return this.state;
  }

  async setScene(name) {
    await this.request('SetCurrentProgramScene', { sceneName: String(name) });
    this.set({ currentScene: name });
  }

  async toggle(which) {
    await this.request(which === 'record' ? 'ToggleRecord' : 'ToggleStream');
    setTimeout(() => this.refresh().catch(() => {}), 800);
  }
}

module.exports = { Obs };
