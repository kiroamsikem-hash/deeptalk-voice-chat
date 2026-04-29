const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

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
  
  // Ekran paylaşımı için
  getDesktopSources: async () => {
    try {
      const sources = await desktopCapturer.getSources({ 
        types: ['window', 'screen'],
        thumbnailSize: { width: 150, height: 150 }
      });
      return sources;
    } catch (error) {
      console.error('desktopCapturer error:', error);
      return [];
    }
  },
  
  // Olay dinleyicilerini kaldır
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

console.log('✅ Preload.js yüklendi, electronAPI hazır');