// VPS'de çalıştırılacak Socket.IO sunucusu - Davet Kodu Sistemi ile
const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

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
    try {
        const privateKey = fs.readFileSync('/etc/letsencrypt/live/deeptalk.qzz.io/privkey.pem', 'utf8');
        const certificate = fs.readFileSync('/etc/letsencrypt/live/deeptalk.qzz.io/cert.pem', 'utf8');
        const ca = fs.readFileSync('/etc/letsencrypt/live/deeptalk.qzz.io/chain.pem', 'utf8');

        const credentials = { key: privateKey, cert: certificate, ca: ca };
        server = https.createServer(credentials, app);
        console.log('🔒 HTTPS sunucusu başlatılıyor...');
    } catch (error) {
        console.log('⚠️ SSL sertifikası bulunamadı, HTTP modunda başlatılıyor...');
        server = http.createServer(app);
    }
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

// Veri yapıları
const rooms = new Map(); // inviteCode -> room data
const users = new Map(); // socketId -> user data
const roomStats = new Map(); // inviteCode -> stats

// Oda veri yapısı
class Room {
    constructor(inviteCode, roomName, password, maxUsers, creator) {
        this.inviteCode = inviteCode;
        this.roomName = roomName;
        this.password = password;
        this.maxUsers = maxUsers;
        this.creator = creator;
        this.users = new Set();
        this.createdAt = new Date();
        this.isActive = true;
    }

    hasPassword() {
        return this.password && this.password.length > 0;
    }

    isFull() {
        return this.users.size >= this.maxUsers;
    }

    checkPassword(inputPassword) {
        if (!this.hasPassword()) return true;
        return this.password === inputPassword;
    }

    addUser(socketId) {
        if (!this.isFull()) {
            this.users.add(socketId);
            return true;
        }
        return false;
    }

    removeUser(socketId) {
        this.users.delete(socketId);
        if (this.users.size === 0) {
            this.isActive = false;
        }
    }

    getUserCount() {
        return this.users.size;
    }
}

// Davet kodu oluşturma
function generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Ana sayfa
app.get('/', (req, res) => {
    res.json({
        message: 'DeepTalk Sesli Konuşma Sunucusu - Davet Kodu Sistemi',
        version: '2.0.0',
        status: 'Çalışıyor',
        activeUsers: users.size,
        activeRooms: rooms.size,
        features: ['Davet Kodu Sistemi', 'Şifre Koruması', 'Kullanıcı Limiti'],
        timestamp: new Date().toISOString()
    });
});

// Sunucu istatistikleri
app.get('/stats', (req, res) => {
    const roomList = Array.from(rooms.values()).map(room => ({
        inviteCode: room.inviteCode,
        roomName: room.roomName,
        userCount: room.getUserCount(),
        maxUsers: room.maxUsers,
        hasPassword: room.hasPassword(),
        creator: room.creator,
        createdAt: room.createdAt,
        isActive: room.isActive
    }));

    const stats = {
        activeUsers: users.size,
        activeRooms: rooms.size,
        rooms: roomList,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    };
    res.json(stats);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'DeepTalk Voice Chat',
        version: '2.0.0',
        timestamp: new Date().toISOString() 
    });
});

io.on('connection', (socket) => {
    console.log(`✅ Yeni kullanıcı bağlandı: ${socket.id} (${socket.handshake.address})`);

    // Oda oluşturma
    socket.on('create-room', (data) => {
        try {
            const { roomName, password, maxUsers, creator } = data;
            let { inviteCode } = data;
            
            if (!roomName || !creator) {
                socket.emit('room-creation-failed', { message: 'Oda adı ve oluşturucu gerekli' });
                return;
            }

            // Davet kodu yoksa oluştur
            if (!inviteCode) {
                inviteCode = generateInviteCode();
            }

            // Davet kodu zaten varsa yeni bir tane oluştur
            while (rooms.has(inviteCode)) {
                inviteCode = generateInviteCode();
            }

            // Yeni oda oluştur
            const room = new Room(inviteCode, roomName, password || '', maxUsers || 10, creator);
            rooms.set(inviteCode, room);
            roomStats.set(inviteCode, { 
                created: new Date(), 
                totalJoins: 0,
                peakUsers: 0
            });

            socket.emit('room-created', {
                inviteCode: inviteCode,
                roomName: roomName,
                hasPassword: room.hasPassword(),
                maxUsers: room.maxUsers
            });

            console.log(`🏠 Yeni oda oluşturuldu: "${roomName}" (${inviteCode}) - ${creator} tarafından`);

        } catch (error) {
            console.error('Oda oluşturma hatası:', error);
            socket.emit('room-creation-failed', { message: 'Oda oluşturulamadı' });
        }
    });

    // Davet kodu ile odaya katılma
    socket.on('join-room-by-code', (data) => {
        try {
            const { inviteCode, userName, password } = data;
            
            if (!inviteCode || !userName) {
                socket.emit('room-join-failed', { message: 'Davet kodu ve kullanıcı adı gerekli' });
                return;
            }

            // Oda var mı kontrol et
            const room = rooms.get(inviteCode.toUpperCase());
            if (!room || !room.isActive) {
                socket.emit('room-join-failed', { message: 'Geçersiz davet kodu' });
                return;
            }

            // Oda dolu mu kontrol et
            if (room.isFull()) {
                socket.emit('room-join-failed', { message: 'Oda dolu' });
                return;
            }

            // Şifre kontrolü
            if (!room.checkPassword(password || '')) {
                socket.emit('room-join-failed', { message: 'Yanlış şifre' });
                return;
            }

            // Önceki odadan ayrıl
            const oldUser = users.get(socket.id);
            if (oldUser && oldUser.roomCode) {
                const oldRoom = rooms.get(oldUser.roomCode);
                if (oldRoom) {
                    oldRoom.removeUser(socket.id);
                    socket.leave(oldUser.roomCode);
                }
            }

            // Yeni odaya katıl
            socket.join(inviteCode);
            room.addUser(socket.id);
            
            users.set(socket.id, { 
                userName, 
                roomCode: inviteCode,
                roomName: room.roomName,
                joinTime: new Date() 
            });

            // İstatistikleri güncelle
            const stats = roomStats.get(inviteCode);
            if (stats) {
                stats.totalJoins++;
                stats.peakUsers = Math.max(stats.peakUsers, room.getUserCount());
            }

            // Odadaki diğer kullanıcılara bildir
            socket.to(inviteCode).emit('user-joined', {
                userId: socket.id,
                userName: userName
            });

            // Mevcut kullanıcıları yeni kullanıcıya gönder
            const roomUsers = Array.from(room.users)
                .filter(id => id !== socket.id)
                .map(id => ({
                    userId: id,
                    userName: users.get(id)?.userName || 'Bilinmeyen'
                }));

            socket.emit('existing-users', roomUsers);

            // Başarılı katılım bildirimi
            socket.emit('room-joined', {
                inviteCode: inviteCode,
                roomName: room.roomName,
                userCount: room.getUserCount(),
                maxUsers: room.maxUsers
            });

            console.log(`👤 ${userName} "${room.roomName}" (${inviteCode}) odasına katıldı (${room.getUserCount()}/${room.maxUsers})`);

        } catch (error) {
            console.error('Odaya katılım hatası:', error);
            socket.emit('room-join-failed', { message: 'Odaya katılım başarısız' });
        }
    });

    // Eski sistem uyumluluğu için (join-room)
    socket.on('join-room', (data) => {
        const { roomId, userName } = data;
        
        // Eski sistemi yeni sisteme yönlendir
        socket.emit('room-join-failed', { 
            message: 'Bu sürümde davet kodu sistemi kullanılmaktadır. Lütfen davet kodu ile giriş yapın.' 
        });
    });

    // WebRTC sinyal iletimi
    socket.on('offer', (data) => {
        try {
            if (data.target && data.offer) {
                socket.to(data.target).emit('offer', {
                    offer: data.offer,
                    caller: socket.id
                });
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

    // Chat mesajı
    socket.on('chat-message', (data) => {
        try {
            const { roomCode, userName, message } = data;
            
            if (!roomCode || !userName || !message) {
                console.log('❌ Eksik chat verisi:', data);
                return;
            }
            
            // Socket'in hangi odalarda olduğunu kontrol et
            const rooms = Array.from(socket.rooms);
            console.log(`💬 [${roomCode}] ${userName}: ${message} (Socket rooms: ${rooms.join(', ')})`);
            
            // Odadaki diğer kullanıcılara mesajı ilet (gönderen hariç)
            const sentCount = socket.to(roomCode).emit('chat-message', {
                userName: userName,
                message: message,
                timestamp: new Date().toISOString()
            });
            
            console.log(`📤 Mesaj ${roomCode} odasına gönderildi`);
            
        } catch (error) {
            console.error('Chat mesaj hatası:', error);
        }
    });

    // Kullanıcı ayrıldığında
    socket.on('disconnect', (reason) => {
        try {
            const user = users.get(socket.id);
            if (user) {
                const { roomCode, userName, roomName } = user;
                
                if (roomCode && rooms.has(roomCode)) {
                    const room = rooms.get(roomCode);
                    room.removeUser(socket.id);
                    
                    // Oda boşaldıysa sil
                    if (room.getUserCount() === 0) {
                        rooms.delete(roomCode);
                        roomStats.delete(roomCode);
                        console.log(`🗑️ Oda "${roomName}" (${roomCode}) boşaldı ve silindi`);
                    } else {
                        console.log(`👋 ${userName} "${roomName}" (${roomCode}) odasından ayrıldı (Kalan: ${room.getUserCount()})`);
                    }
                    
                    // Odadaki diğer kullanıcılara bildir
                    socket.to(roomCode).emit('user-left', {
                        userId: socket.id,
                        userName: userName
                    });
                }
                
                users.delete(socket.id);
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

// Periyodik temizlik ve istatistikler
setInterval(() => {
    const totalUsers = users.size;
    const totalRooms = rooms.size;
    
    if (totalUsers > 0 || totalRooms > 0) {
        console.log(`📊 Aktif kullanıcı: ${totalUsers}, Aktif oda: ${totalRooms}`);
        
        // Aktif odaları listele
        rooms.forEach((room, inviteCode) => {
            if (room.getUserCount() > 0) {
                const userNames = Array.from(room.users).map(id => users.get(id)?.userName || 'Bilinmeyen');
                console.log(`   🏠 "${room.roomName}" (${inviteCode}): ${room.getUserCount()}/${room.maxUsers} [${userNames.join(', ')}]`);
            }
        });
    }
    
    // Boş odaları temizle (güvenlik için)
    rooms.forEach((room, inviteCode) => {
        if (room.getUserCount() === 0 && !room.isActive) {
            rooms.delete(inviteCode);
            roomStats.delete(inviteCode);
        }
    });
    
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
    console.log(`🔐 Davet kodu sistemi aktif`);
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