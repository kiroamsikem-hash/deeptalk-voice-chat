const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

console.log('🔧 Preload.js başlatılıyor...');
console.log('desktopCapturer:', typeof desktopCapturer);

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
      console.log('📺 desktopCapturer.getSources çağrılıyor...');
      if (!desktopCapturer || !desktopCapturer.getSources) {
        console.error('❌ desktopCapturer.getSources bulunamadı!');
        return [];
      }
      const sources = await desktopCapturer.getSources({ 
        types: ['window', 'screen'],
        thumbnailSize: { width: 150, height: 150 }
      });
      console.log(`✅ ${sources.length} kaynak bulundu`);
      return sources;
    } catch (error) {
      console.error('❌ desktopCapturer hatası:', error);
      return [];
    }
  },
  
  // Olay dinleyicilerini kaldır
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

console.log('✅ Preload.js yüklendi, electronAPI hazır');
console.log('electronAPI.getDesktopSources:', typeof window?.electronAPI?.getDesktopSources);