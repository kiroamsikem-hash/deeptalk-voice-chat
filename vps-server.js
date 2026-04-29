// VPS'de çalıştırılacak Socket.IO sunucusu
// Bu dosyayı VPS'nizde çalıştırın

const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// CORS ayarları
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
}));

app.use(express.static('public'));

// SSL sertifikası varsa HTTPS, yoksa HTTP
let server;
const useHTTPS = process.env.USE_HTTPS === 'true';

if (useHTTPS) {
    // SSL sertifika dosyalarınızın yolu
    const privateKey = fs.readFileSync('/etc/letsencrypt/live/deeptalk.qzz.io/privkey.pem', 'utf8');
    const certificate = fs.readFileSync('/etc/letsencrypt/live/deeptalk.qzz.io/cert.pem', 'utf8');
    const ca = fs.readFileSync('/etc/letsencrypt/live/deeptalk.qzz.io/chain.pem', 'utf8');

    const credentials = {
        key: privateKey,
        cert: certificate,
        ca: ca
    };

    server = https.createServer(credentials, app);
    console.log('🔒 HTTPS sunucusu başlatılıyor...');
} else {
    server = http.createServer(app);
    console.log('🌐 HTTP sunucusu başlatılıyor...');
}

// Socket.IO yapılandırması
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Aktif kullanıcıları ve odaları takip et
const rooms = new Map();
const users = new Map();
const roomStats = new Map();

// Ana sayfa
app.get('/', (req, res) => {
    res.json({
        message: 'DeepTalk Sesli Konuşma Sunucusu',
        version: '1.0.0',
        status: 'Çalışıyor',
        activeUsers: users.size,
        activeRooms: rooms.size,
        timestamp: new Date().toISOString()
    });
});

// Sunucu istatistikleri
app.get('/stats', (req, res) => {
    const stats = {
        activeUsers: users.size,
        activeRooms: rooms.size,
        roomDetails: Array.from(rooms.entries()).map(([roomId, userSet]) => ({
            roomId,
            userCount: userSet.size,
            users: Array.from(userSet).map(userId => users.get(userId)?.userName || 'Bilinmeyen')
        })),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    };
    res.json(stats);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

io.on('connection', (socket) => {
    console.log(`✅ Yeni kullanıcı bağlandı: ${socket.id} (${socket.handshake.address})`);

    // Kullanıcı odaya katıl
    socket.on('join-room', (data) => {
        try {
            const { roomId, userName } = data;
            
            if (!roomId || !userName) {
                socket.emit('error', { message: 'Oda ID ve kullanıcı adı gerekli' });
                return;
            }

            // Önceki odadan ayrıl
            const oldUser = users.get(socket.id);
            if (oldUser && oldUser.roomId) {
                socket.leave(oldUser.roomId);
                if (rooms.has(oldUser.roomId)) {
                    rooms.get(oldUser.roomId).delete(socket.id);
                }
            }

            socket.join(roomId);
            users.set(socket.id, { userName, roomId, joinTime: new Date() });
            
            if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set());
                roomStats.set(roomId, { created: new Date(), totalJoins: 0 });
            }
            rooms.get(roomId).add(socket.id);
            roomStats.get(roomId).totalJoins++;
            
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
                    userName: users.get(id)?.userName || 'Bilinmeyen'
                }));
            
            socket.emit('existing-users', roomUsers);
            
            console.log(`👤 ${userName} "${roomId}" odasına katıldı (Toplam: ${rooms.get(roomId).size} kullanıcı)`);
        } catch (error) {
            console.error('Join room hatası:', error);
            socket.emit('error', { message: 'Odaya katılım başarısız' });
        }
    });

    // WebRTC sinyal iletimi
    socket.on('offer', (data) => {
        try {
            if (data.target && data.offer) {
                socket.to(data.target).emit('offer', {
                    offer: data.offer,
                    caller: socket.id
                });
                console.log(`📞 Offer: ${socket.id} -> ${data.target}`);
            }
        } catch (error) {
            console.error('Offer hatası:', error);
        }
    });

    socket.on('answer', (data) => {
        try {
            if (data.target && data.answer) {
                socket.to(data.target).emit('answer', {
                    answer: data.answer,
                    answerer: socket.id
                });
                console.log(`📞 Answer: ${socket.id} -> ${data.target}`);
            }
        } catch (error) {
            console.error('Answer hatası:', error);
        }
    });

    socket.on('ice-candidate', (data) => {
        try {
            if (data.target && data.candidate) {
                socket.to(data.target).emit('ice-candidate', {
                    candidate: data.candidate,
                    sender: socket.id
                });
            }
        } catch (error) {
            console.error('ICE candidate hatası:', error);
        }
    });

    // Kullanıcı ayrıldığında
    socket.on('disconnect', (reason) => {
        try {
            const user = users.get(socket.id);
            if (user) {
                const { roomId, userName } = user;
                
                if (rooms.has(roomId)) {
                    rooms.get(roomId).delete(socket.id);
                    if (rooms.get(roomId).size === 0) {
                        rooms.delete(roomId);
                        roomStats.delete(roomId);
                        console.log(`🗑️ Oda "${roomId}" boşaldı ve silindi`);
                    } else {
                        console.log(`👋 ${userName} "${roomId}" odasından ayrıldı (Kalan: ${rooms.get(roomId).size} kullanıcı)`);
                    }
                }
                
                users.delete(socket.id);
                
                // Odadaki diğer kullanıcılara bildir
                socket.to(roomId).emit('user-left', {
                    userId: socket.id,
                    userName: userName
                });
            }
            
            console.log(`❌ Kullanıcı ayrıldı: ${socket.id} (Sebep: ${reason})`);
        } catch (error) {
            console.error('Disconnect hatası:', error);
        }
    });

    // Hata yönetimi
    socket.on('error', (error) => {
        console.error(`🚨 Socket hatası (${socket.id}):`, error);
    });
});

// Periyodik istatistikler
setInterval(() => {
    const totalUsers = users.size;
    const totalRooms = rooms.size;
    if (totalUsers > 0) {
        console.log(`📊 Aktif kullanıcı: ${totalUsers}, Aktif oda: ${totalRooms}`);
        
        // Detaylı oda bilgileri
        rooms.forEach((userSet, roomId) => {
            if (userSet.size > 0) {
                const userNames = Array.from(userSet).map(id => users.get(id)?.userName || 'Bilinmeyen');
                console.log(`   📁 Oda "${roomId}": ${userSet.size} kullanıcı [${userNames.join(', ')}]`);
            }
        });
    }
}, 60000); // 1 dakikada bir

// Port ayarları
const HTTP_PORT = process.env.HTTP_PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const PORT = useHTTPS ? HTTPS_PORT : HTTP_PORT;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DeepTalk sunucusu ${PORT} portunda çalışıyor`);
    console.log(`🌐 Protokol: ${useHTTPS ? 'HTTPS' : 'HTTP'}`);
    console.log(`📡 WebSocket bağlantıları kabul ediliyor`);
    console.log(`🔗 Erişim: ${useHTTPS ? 'https' : 'http'}://deeptalk.qzz.io${PORT !== (useHTTPS ? 443 : 80) ? ':' + PORT : ''}`);
    console.log(`📈 İstatistikler: /stats endpoint'i`);
    console.log(`💚 Health check: /health endpoint'i`);
});

// HTTP'den HTTPS'e yönlendirme (SSL varsa)
if (useHTTPS && HTTP_PORT !== HTTPS_PORT) {
    const httpApp = express();
    httpApp.use((req, res) => {
        res.redirect(301, `https://${req.headers.host}${req.url}`);
    });
    
    httpApp.listen(HTTP_PORT, '0.0.0.0', () => {
        console.log(`🔄 HTTP yönlendirme sunucusu ${HTTP_PORT} portunda çalışıyor`);
    });
}

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

// Hata yakalama
process.on('uncaughtException', (error) => {
    console.error('🚨 Yakalanmamış hata:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 İşlenmemiş promise reddi:', reason);
});