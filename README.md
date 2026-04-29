# Sesli Konuşma Uygulaması

Arkadaşlarınızla yüksek kaliteli sesli sohbet etmek için tasarlanmış modern masaüstü uygulaması.

## Özellikler

🎙️ **Yüksek Kaliteli Ses**: WebRTC teknolojisi ile kristal berraklığında ses kalitesi
🔊 **Gerçek Zamanlı İletişim**: Anlık ses iletimi, gecikme yok
🎧 **Ses Kontrolleri**: Mikrofon ve hoparlör kontrolü, ses seviyesi ayarları
👥 **Çoklu Kullanıcı**: Aynı odada birden fazla kişi konuşabilir
🔒 **Güvenli**: Peer-to-peer bağlantı ile güvenli iletişim
🎨 **Modern Arayüz**: Kullanıcı dostu ve şık tasarım

## Kurulum

### Gereksinimler
- Node.js (v16 veya üzeri)
- npm veya yarn

### Adımlar

1. **Bağımlılıkları yükleyin:**
   ```bash
   npm install
   ```

2. **Uygulamayı çalıştırın:**
   ```bash
   npm start
   ```

3. **Geliştirme modu:**
   ```bash
   npm run dev
   ```

## Derleme

### Windows için:
```bash
npm run build-win
```

### macOS için:
```bash
npm run build-mac
```

### Linux için:
```bash
npm run build-linux
```

## Kullanım

1. **Uygulamayı başlatın**
2. **Kullanıcı adınızı girin**
3. **Oda adı belirleyin** (aynı oda adını kullanan herkes birbirinizi duyabilir)
4. **Sunucu ayarlarını yapın** (isteğe bağlı)
5. **"Odaya Katıl" butonuna tıklayın**

### Klavye Kısayolları

- **Space**: Mikrofonu aç/kapat
- **Ctrl+N**: Yeni oda
- **Ctrl+Q**: Uygulamadan çık

### Ses Kontrolleri

- **Mikrofon Butonu**: Mikrofonunuzu açıp kapatabilirsiniz
- **Hoparlör Butonu**: Diğer kullanıcıları duyup duymamayı kontrol edebilirsiniz
- **Ses Seviyesi**: Hoparlör ses seviyesini ayarlayabilirsiniz
- **Ses Ayarları**: Mikrofon ve hoparlör cihazlarını seçebilirsiniz

## Sunucu Kurulumu

Bu uygulama bir sunucu gerektirir. Basit bir Socket.IO sunucusu kurabilirsiniz:

```javascript
// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = new Map();
const users = new Map();

io.on('connection', (socket) => {
  socket.on('join-room', (data) => {
    const { roomId, userName } = data;
    socket.join(roomId);
    users.set(socket.id, { userName, roomId });
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);
    
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });
    
    const roomUsers = Array.from(rooms.get(roomId))
      .filter(id => id !== socket.id)
      .map(id => ({
        userId: id,
        userName: users.get(id)?.userName
      }));
    
    socket.emit('existing-users', roomUsers);
  });

  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      caller: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      answerer: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { roomId } = user;
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
        }
      }
      users.delete(socket.id);
      socket.to(roomId).emit('user-left', {
        userId: socket.id,
        userName: user.userName
      });
    }
  });
});

server.listen(3001, () => {
  console.log('Sunucu 3001 portunda çalışıyor');
});
```

Sunucuyu çalıştırmak için:
```bash
node server.js
```

## Sorun Giderme

### Mikrofon Çalışmıyor
- Tarayıcı/uygulama izinlerini kontrol edin
- Mikrofon cihazının bağlı olduğundan emin olun
- Ses ayarlarından doğru mikrofonu seçin

### Bağlantı Sorunu
- Sunucu adresinin doğru olduğundan emin olun
- Firewall ayarlarını kontrol edin
- İnternet bağlantınızı kontrol edin

### Ses Kalitesi Düşük
- İnternet bağlantı hızınızı kontrol edin
- Gürültü bastırma özelliğini açın
- Mikrofonunuzu ağzınıza yaklaştırın

## Teknik Detaylar

- **Electron**: Masaüstü uygulama framework'ü
- **WebRTC**: Peer-to-peer ses iletimi
- **Socket.IO**: Gerçek zamanlı iletişim
- **Web Audio API**: Ses analizi ve işleme

## Lisans

MIT License - Detaylar için LICENSE dosyasına bakın.

## Katkıda Bulunma

1. Fork edin
2. Feature branch oluşturun (`git checkout -b feature/amazing-feature`)
3. Commit edin (`git commit -m 'Add amazing feature'`)
4. Push edin (`git push origin feature/amazing-feature`)
5. Pull Request açın

## Destek

Sorularınız için issue açabilir veya e-posta gönderebilirsiniz.