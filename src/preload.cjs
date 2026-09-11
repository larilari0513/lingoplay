'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const calls = ['bootstrap','save-settings','save-key','check-api','list-sources','capture','translate-text','translate-screen','copy','overlay','overlay-content','voice-start','voice-bind','voice-stop','stop-all','open-guide','unlock-overlay'];
const events = ['voice-event','hotkey','emergency-stop','overlay-visible','overlay-locked','app-warning'];
contextBridge.exposeInMainWorld('lingo', {
  call: async (name, payload) => { if (!calls.includes(name)) throw new Error('허용되지 않은 요청'); const result = await ipcRenderer.invoke(name, payload); if (!result.ok) throw new Error(result.error); return result.value; },
  audio: (lane, token, bytes) => ipcRenderer.send('voice-audio', { lane, token, bytes }),
  on: (name, callback) => { if (!events.includes(name)) return; const listener = (_e, data) => callback(data); ipcRenderer.on(name, listener); return () => ipcRenderer.removeListener(name, listener); }
});
