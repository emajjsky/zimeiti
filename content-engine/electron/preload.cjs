const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('contentEngine', {
  platform: process.platform,
  version: '0.1.0',
  state: {
    load: () => ipcRenderer.invoke('state:load'),
    save: (state) => ipcRenderer.invoke('state:save', state),
  },
  intelligence: {
    refreshRss: (sources) => ipcRenderer.invoke('intelligence:refresh-rss', sources),
    onUpdated: (callback) => {
      const listener = (_event, intelligence) => callback(intelligence);
      ipcRenderer.on('intelligence:updated', listener);
      return () => ipcRenderer.removeListener('intelligence:updated', listener);
    },
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    save: (input) => ipcRenderer.invoke('models:save', input),
    test: (id) => ipcRenderer.invoke('models:test', id),
  },
});
