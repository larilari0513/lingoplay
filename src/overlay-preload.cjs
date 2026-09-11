'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('captions', { on: callback => ipcRenderer.on('overlay-state', (_e, data) => callback(data)), control: command => ipcRenderer.invoke('overlay-control', command) });
