const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // renderer -> main (fire and forget)
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  // renderer -> main (request/response)
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  // main -> renderer subscription; returns an unsubscribe fn
  on: (channel, cb) => {
    const listener = (_event, ...args) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
