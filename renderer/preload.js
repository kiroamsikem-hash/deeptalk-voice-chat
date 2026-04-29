const { contextBridge, ipcRenderer } = require('electron');

// Güvenli API'leri renderer sürecine açığa çıkar
contextBridge.exposeInMainWorld('electronAPI', {
  // Uygulama bilgileri
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Dialog'lar
  showErrorDialog: (title, content) => ipcRenderer.invoke('show-error-dialog', title, content),
  showInfoDialog: (title, content) => ipcRenderer.invoke('show-info-dialog', title, content),
  
  // Menü olayları
  onNewRoom: (callback) => ipcRenderer.on('new-room', callback),
  onToggleMute: (callback) => ipcRenderer.on('toggle-mute', callback),
  onAudioSettings: (callback) => ipcRenderer.on('audio-settings', callback),
  
  // Olay dinleyicilerini kaldır
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});