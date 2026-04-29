// Basit Socket.IO sunucusu örneği
// Bu dosyayı ayrı bir klasörde çalıştırabilirsiniz

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());

// Aktif kullanıcıları ve odaları takip et
const rooms = new Map();
const users = new Map();

io.on('connection', (socket) => {
  console.log('Yeni kullanıcı bağlandı:', socket.id);

  // Kullanıcı odaya katıl
  socket.on('join-room', (data) => {
    const { roomId, userName } = data;
    
    socket.join(roomId);
    users.set(socket.id, { userName, roomId });
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);
    
    // Odadaki diğer kullanıcılara bildir
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });
    
    // Mevcut kullanıcıları yeni kullanıcıya gönder
    const roomUsers = Array.from(rooms.get(roomId))
      .filter(id => id !== socket.id)
      .map(id => ({
        userId: id,
        userName: users.get(id)?.userName
      }));
    
    socket.emit('existing-users', roomUsers);
    
    console.log(`${userName} ${roomId} odasına katıldı`);
    console.log(`Oda ${roomId} kullanıcı sayısı: ${rooms.get(roomId).size}`);
  });

  // WebRTC sinyal iletimi
  socket.on('offer', (data) => {
    console.log(`Offer gönderiliyor: ${socket.id} -> ${data.target}`);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      caller: socket.id
    });
  });

  socket.on('answer', (data) => {
    console.log(`Answer gönderiliyor: ${socket.id} -> ${data.target}`);
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

  // Kullanıcı ayrıldığında
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const { roomId, userName } = user;
      
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete(socket.id);
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
          console.log(`Oda ${roomId} boşaldı ve silindi`);
        } else {
          console.log(`Oda ${roomId} kullanıcı sayısı: ${rooms.get(roomId).size}`);
        }
      }
      
      users.delete(socket.id);
      
      // Odadaki diğer kullanıcılara bildir
      socket.to(roomId).emit('user-left', {
        userId: socket.id,
        userName: userName
      });
      
      console.log(`${userName} ayrıldı`);
    }
  });

  // Hata yönetimi
  socket.on('error', (error) => {
    console.error('Socket hatası:', error);
  });
});

// Sunucu istatistikleri
setInterval(() => {
  const totalUsers = users.size;
  const totalRooms = rooms.size;
  if (totalUsers > 0) {
    console.log(`Aktif kullanıcı: ${totalUsers}, Aktif oda: ${totalRooms}`);
  }
}, 30000); // 30 saniyede bir

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Sesli konuşma sunucusu ${PORT} portunda çalışıyor`);
  console.log(`📡 WebSocket bağlantıları kabul ediliyor`);
  console.log(`🔗 Bağlantı adresi: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Sunucu kapatılıyor...');
  server.close(() => {
    console.log('✅ Sunucu başarıyla kapatıldı');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Sunucu sonlandırılıyor...');
  server.close(() => {
    console.log('✅ Sunucu başarıyla sonlandırıldı');
    process.exit(0);
  });
});