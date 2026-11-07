const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  readTasks: () => ipcRenderer.invoke('page:read'),
  addTask: value => ipcRenderer.invoke('page:add', value),
  editEntry: (id, value) => ipcRenderer.invoke('page:edit', id, value),
  deleteEntry: id => ipcRenderer.invoke('page:delete', id),
  completeTask: id => ipcRenderer.invoke('page:toggle', id),
  clearCompleted: () => ipcRenderer.invoke('page:clear'),
  setTitle: value => ipcRenderer.invoke('page:title', value),
  appendLog: () => ipcRenderer.invoke('page:sync'),
  setPinned: value => ipcRenderer.invoke('window:pin', value),
  getBounds: () => ipcRenderer.invoke('window:bounds'),
  move: (x, y) => ipcRenderer.invoke('window:move', x, y),
  resize: (width, height) => ipcRenderer.invoke('window:size', width, height),
  close: () => ipcRenderer.invoke('window:close'),
  onState: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('page:state', listener);
    return () => ipcRenderer.removeListener('page:state', listener);
  }
});
