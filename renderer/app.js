// DeepTalk Voice Chat - Client Application
const SERVER_URL = 'https://deeptalk.qzz.io';

// Global değişkenler
let socket = null;
let localStream = null;
let screenStream = null;
let peers = new Map();
let currentRoom = null;
let currentCode = null;
let currentUser = null;
let isMicMuted = false;
let isSpeakerMuted = false;
let isCameraOn = false;
let isScreenSharing = false;

// Ayarlar
let settings = {
    micId: null,
    speakerId: null,
    cameraId: null,
    videoQuality: 720,
    screenFps: 30
};

// ICE sunucuları
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DeepTalk başlatılıyor...');
    console.log('electronAPI mevcut mu?', typeof window.electronAPI !== 'undefined');
    
    if (window.electronAPI) {
        console.log('✅ Electron API hazır');
    } else {
        console.log('⚠️ Electron API bulunamadı, tarayıcı modunda çalışıyor');
    }
    
    initSocket();
    loadDevices();
    updateStatus('Bağlantı bekleniyor...');
});

// Socket.IO bağlantısı
function initSocket() {
    socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10
    });

    socket.on('connect', () => {
        console.log('✅ Sunucuya bağlandı');
        updateStatus('Bağlı');
    });

    socket.on('disconnect', () => {
        console.log('❌ Sunucu bağlantısı kesildi');
        updateStatus('Bağlantı kesildi');
    });

    socket.on('connect_error', (error) => {
        console.error('Bağlantı hatası:', error);
        updateStatus('Bağlantı hatası');
    });

    // Oda oluşturuldu
    socket.on('room-created', (data) => {
        console.log('Oda oluşturuldu:', data);
        currentCode = data.inviteCode;
        currentRoom = data.roomName;
        document.getElementById('invite-code').textContent = data.inviteCode;
        showScreen('invite');
    });

    // Oda oluşturma başarısız
    socket.on('room-creation-failed', (data) => {
        alert('Oda oluşturulamadı: ' + data.message);
    });

    // Odaya katılım başarılı
    socket.on('room-joined', (data) => {
        console.log('✅ Odaya katıldı:', data);
        currentCode = data.inviteCode;
        currentRoom = data.roomName;
        currentUser = currentUser || 'Kullanıcı'; // Emin ol ki currentUser set edilmiş
        
        document.getElementById('room-name').textContent = data.roomName;
        document.getElementById('room-code').textContent = data.inviteCode;
        document.getElementById('messages').innerHTML = '';
        showScreen('chat');
        startLocalStream();
        updateStatus(`${data.userCount}/${data.maxUsers} kullanıcı`);
        addSystemMessage(`${data.roomName} odasına hoş geldiniz!`);
        
        console.log('📍 Oda bilgileri:', { currentCode, currentRoom, currentUser });
    });

    // Odaya katılım başarısız
    socket.on('room-join-failed', (data) => {
        alert('Odaya katılım başarısız: ' + data.message);
    });

    // Mevcut kullanıcılar
    socket.on('existing-users', (users) => {
        console.log('Mevcut kullanıcılar:', users);
        users.forEach(user => {
            addUserToList(user.userId, user.userName);
            createPeerConnection(user.userId, true);
        });
        updateUserCount();
    });

    // Yeni kullanıcı katıldı
    socket.on('user-joined', (data) => {
        console.log('Yeni kullanıcı:', data);
        addUserToList(data.userId, data.userName);
        createPeerConnection(data.userId, false);
        updateUserCount();
        addSystemMessage(`${data.userName} odaya katıldı`);
    });

    // Kullanıcı ayrıldı
    socket.on('user-left', (data) => {
        console.log('Kullanıcı ayrıldı:', data);
        removeUserFromList(data.userId);
        closePeerConnection(data.userId);
        updateUserCount();
        addSystemMessage(`${data.userName} odadan ayrıldı`);
    });

    // WebRTC sinyalleri
    socket.on('offer', async (data) => {
        console.log('Offer alındı:', data.caller);
        const peer = peers.get(data.caller);
        if (peer) {
            try {
                await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peer.createAnswer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                await peer.setLocalDescription(answer);
                socket.emit('answer', { target: data.caller, answer: answer });
                console.log('Answer gönderildi:', data.caller);
            } catch (error) {
                console.error('Answer oluşturma hatası:', error);
            }
        }
    });

    socket.on('answer', async (data) => {
        console.log('Answer alındı:', data.answerer);
        const peer = peers.get(data.answerer);
        if (peer) {
            try {
                await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
                console.log('Answer set edildi:', data.answerer);
            } catch (error) {
                console.error('Answer set hatası:', error);
            }
        }
    });

    socket.on('ice-candidate', async (data) => {
        const peer = peers.get(data.sender);
        if (peer && data.candidate) {
            await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });

    // Chat mesajları
    socket.on('chat-message', (data) => {
        console.log('💬 Chat mesajı alındı:', data);
        addMessage(data.userName, data.message, false);
    });
}

// Tab değiştirme
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    if (tab === 'join') {
        document.querySelectorAll('.tab')[0].classList.add('active');
        document.getElementById('join-tab').classList.add('active');
    } else {
        document.querySelectorAll('.tab')[1].classList.add('active');
        document.getElementById('create-tab').classList.add('active');
    }
}

// Odaya katıl
function join() {
    const name = document.getElementById('name-join').value.trim();
    const code = document.getElementById('code').value.trim().toUpperCase();
    
    if (!name) {
        alert('Lütfen adınızı girin');
        return;
    }
    
    if (!code || code.length !== 6) {
        alert('Lütfen 6 haneli davet kodunu girin');
        return;
    }
    
    currentUser = name;
    socket.emit('join-room-by-code', {
        inviteCode: code,
        userName: name,
        password: ''
    });
}

// Oda oluştur
function create() {
    const name = document.getElementById('name-create').value.trim();
    const roomname = document.getElementById('roomname').value.trim();
    
    if (!name) {
        alert('Lütfen adınızı girin');
        return;
    }
    
    if (!roomname) {
        alert('Lütfen oda adı girin');
        return;
    }
    
    currentUser = name;
    socket.emit('create-room', {
        roomName: roomname,
        password: '',
        maxUsers: 10,
        creator: name
    });
}

// Davet kodunu kopyala
function copyCode() {
    const code = document.getElementById('invite-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        alert('Davet kodu kopyalandı: ' + code);
    });
}

// Odaya gir (davet ekranından)
function enterRoom() {
    socket.emit('join-room-by-code', {
        inviteCode: currentCode,
        userName: currentUser,
        password: ''
    });
}

// Odadan ayrıl
function leave() {
    stopLocalStream();
    stopScreenStream();
    peers.forEach((peer, id) => closePeerConnection(id));
    peers.clear();
    
    currentRoom = null;
    currentCode = null;
    currentUser = null;
    
    document.getElementById('userlist').innerHTML = '';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('name-join').value = '';
    document.getElementById('code').value = '';
    document.getElementById('name-create').value = '';
    document.getElementById('roomname').value = '';
    
    showScreen('login');
    
    if (socket) {
        socket.disconnect();
        socket.connect();
    }
}

// Ekran göster
function showScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screen).classList.add('active');
}

// Mikrofon aç/kapat
function toggleMic() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        isMicMuted = !isMicMuted;
        audioTrack.enabled = !isMicMuted;
        
        const btn = document.getElementById('mic');
        if (isMicMuted) {
            btn.classList.add('muted');
            btn.textContent = '🎤🚫';
        } else {
            btn.classList.remove('muted');
            btn.textContent = '🎤';
        }
    }
}

// Hoparlör aç/kapat
function toggleSpeaker() {
    isSpeakerMuted = !isSpeakerMuted;
    
    document.querySelectorAll('audio').forEach(audio => {
        audio.muted = isSpeakerMuted;
    });
    
    const btn = document.getElementById('speaker');
    if (isSpeakerMuted) {
        btn.classList.add('muted');
        btn.textContent = '🔇';
    } else {
        btn.classList.remove('muted');
        btn.textContent = '🔊';
    }
}

// Kamera aç/kapat
async function toggleCamera() {
    if (!isCameraOn) {
        try {
            const constraints = {
                video: {
                    deviceId: settings.cameraId ? { exact: settings.cameraId } : undefined,
                    width: { ideal: settings.videoQuality },
                    height: { ideal: settings.videoQuality * 0.75 }
                }
            };
            
            const videoStream = await navigator.mediaDevices.getUserMedia(constraints);
            const videoTrack = videoStream.getVideoTracks()[0];
            
            // Mevcut stream'e video track ekle
            if (localStream) {
                localStream.addTrack(videoTrack);
                
                // Tüm peer'lara video track gönder
                peers.forEach(peer => {
                    const sender = peer.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    } else {
                        peer.addTrack(videoTrack, localStream);
                    }
                });
            }
            
            // Video önizleme göster
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = new MediaStream([videoTrack]);
            localVideo.style.display = 'block';
            
            isCameraOn = true;
            document.getElementById('camera').classList.add('active');
            
        } catch (error) {
            console.error('Kamera açma hatası:', error);
            alert('Kamera açılamadı: ' + error.message);
        }
    } else {
        // Kamerayı kapat
        if (localStream) {
            const videoTracks = localStream.getVideoTracks();
            videoTracks.forEach(track => {
                track.stop();
                localStream.removeTrack(track);
            });
            
            // Peer'lardan video track'i kaldır
            peers.forEach(peer => {
                const sender = peer.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    peer.removeTrack(sender);
                }
            });
        }
        
        document.getElementById('local-video').style.display = 'none';
        isCameraOn = false;
        document.getElementById('camera').classList.remove('active');
    }
}

// Ekran paylaşımı aç/kapat
async function toggleScreen() {
    if (!isScreenSharing) {
        try {
            console.log('Ekran paylaşımı başlatılıyor...');
            
            // Electron API kontrolü
            if (window.electronAPI && window.electronAPI.getDesktopSources) {
                console.log('Electron API kullanılıyor...');
                
                try {
                    const sources = await window.electronAPI.getDesktopSources();
                    console.log('Bulunan kaynaklar:', sources.length);
                    
                    if (sources.length === 0) {
                        alert('Paylaşılacak ekran bulunamadı');
                        return;
                    }
                    
                    // İlk ekranı seç
                    const selectedSource = sources[0];
                    console.log('Seçilen kaynak:', selectedSource.name);
                    
                    const constraints = {
                        audio: false,
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: selectedSource.id,
                                minWidth: 1280,
                                maxWidth: 1920,
                                minHeight: 720,
                                maxHeight: 1080,
                                minFrameRate: 15,
                                maxFrameRate: settings.screenFps
                            }
                        }
                    };
                    
                    screenStream = await navigator.mediaDevices.getUserMedia(constraints);
                    
                } catch (apiError) {
                    console.error('Electron API hatası:', apiError);
                    throw apiError;
                }
                
            } else {
                console.log('Standart getDisplayMedia kullanılıyor...');
                
                // Standart getDisplayMedia API
                const constraints = {
                    video: {
                        width: { ideal: 1920, max: 1920 },
                        height: { ideal: 1080, max: 1080 },
                        frameRate: { ideal: settings.screenFps, max: 60 }
                    },
                    audio: false
                };
                
                screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
            }
            
            const screenTrack = screenStream.getVideoTracks()[0];
            console.log('✅ Ekran track oluşturuldu:', screenTrack.getSettings());
            
            // Ekran paylaşımı durdurulduğunda
            screenTrack.onended = () => {
                console.log('Ekran paylaşımı durduruldu');
                stopScreenStream();
            };
            
            // Tüm peer'lara ekran track'i gönder
            let tracksSent = 0;
            peers.forEach((peer, userId) => {
                const sender = peer.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(screenTrack)
                        .then(() => {
                            tracksSent++;
                            console.log(`✅ Ekran track'i ${userId}'ye gönderildi`);
                        })
                        .catch(e => console.error(`❌ Track replace error for ${userId}:`, e));
                } else {
                    peer.addTrack(screenTrack, screenStream);
                    tracksSent++;
                    console.log(`✅ Ekran track'i ${userId}'ye eklendi`);
                }
            });
            
            console.log(`📺 Ekran ${tracksSent} peer'a gönderildi`);
            
            // Ekran önizleme göster
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = screenStream;
            localVideo.style.display = 'block';
            
            isScreenSharing = true;
            document.getElementById('screen').classList.add('active');
            
            if (isCameraOn) {
                document.getElementById('camera').classList.remove('active');
            }
            
            updateStatus('Ekran paylaşılıyor');
            
        } catch (error) {
            console.error('❌ Ekran paylaşımı hatası:', error);
            
            if (error.name === 'NotAllowedError') {
                console.log('Kullanıcı ekran paylaşımını reddetti');
            } else {
                alert('Ekran paylaşımı başlatılamadı: ' + error.message);
            }
        }
    } else {
        stopScreenStream();
    }
}

// Ayarları göster
function showSettings() {
    loadDevices();
    document.getElementById('settings-modal').classList.add('active');
}

// Ayarları kapat
function closeSettings() {
    document.getElementById('settings-modal').classList.remove('active');
}

// Ayarları kaydet
async function saveSettings() {
    settings.micId = document.getElementById('mic-select').value;
    settings.speakerId = document.getElementById('speaker-select').value;
    settings.cameraId = document.getElementById('camera-select').value;
    settings.videoQuality = parseInt(document.getElementById('quality').value);
    settings.screenFps = parseInt(document.getElementById('fps').value);
    
    // Mikrofonu yeniden başlat
    if (localStream) {
        await stopLocalStream();
        await startLocalStream();
    }
    
    closeSettings();
    alert('Ayarlar kaydedildi');
}

// Cihazları yükle
async function loadDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const micSelect = document.getElementById('mic-select');
        const speakerSelect = document.getElementById('speaker-select');
        const cameraSelect = document.getElementById('camera-select');
        
        micSelect.innerHTML = '';
        speakerSelect.innerHTML = '';
        cameraSelect.innerHTML = '';
        
        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `${device.kind} ${device.deviceId.substr(0, 5)}`;
            
            if (device.kind === 'audioinput') {
                micSelect.appendChild(option);
            } else if (device.kind === 'audiooutput') {
                speakerSelect.appendChild(option);
            } else if (device.kind === 'videoinput') {
                cameraSelect.appendChild(option);
            }
        });
        
        // Mevcut ayarları seç
        if (settings.micId) micSelect.value = settings.micId;
        if (settings.speakerId) speakerSelect.value = settings.speakerId;
        if (settings.cameraId) cameraSelect.value = settings.cameraId;
        
    } catch (error) {
        console.error('Cihaz listesi alınamadı:', error);
    }
}

// Yerel stream başlat
async function startLocalStream() {
    try {
        const constraints = {
            audio: {
                deviceId: settings.micId ? { exact: settings.micId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 1
            },
            video: false
        };
        
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        console.log('✅ Mikrofon stream oluşturuldu');
        
        // Mevcut peer'lara stream ekle
        peers.forEach((peer, userId) => {
            localStream.getTracks().forEach(track => {
                console.log(`Adding ${track.kind} track to peer ${userId}`);
                peer.addTrack(track, localStream);
            });
        });
        
        updateStatus('Mikrofon aktif');
        
    } catch (error) {
        console.error('Mikrofon erişim hatası:', error);
        updateStatus('Mikrofon hatası');
        alert('Mikrofon erişimi reddedildi');
    }
}

// Yerel stream durdur
function stopLocalStream() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    isCameraOn = false;
    document.getElementById('local-video').style.display = 'none';
    document.getElementById('camera').classList.remove('active');
}

// Ekran stream durdur
function stopScreenStream() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    // Kamera açıksa kameraya geri dön
    if (isCameraOn && localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            peers.forEach(peer => {
                const sender = peer.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack).catch(e => console.error('Track replace error:', e));
                }
            });
            document.getElementById('local-video').srcObject = new MediaStream([videoTrack]);
            document.getElementById('camera').classList.add('active');
        }
    } else {
        // Kamera kapalıysa video track'i kaldır
        peers.forEach(peer => {
            const sender = peer.getSenders().find(s => s.track?.kind === 'video');
            if (sender && sender.track) {
                sender.replaceTrack(null).catch(e => console.error('Track remove error:', e));
            }
        });
        document.getElementById('local-video').style.display = 'none';
    }
    
    isScreenSharing = false;
    document.getElementById('screen').classList.remove('active');
}

// Peer bağlantısı oluştur
function createPeerConnection(userId, isInitiator) {
    console.log(`Creating peer connection for ${userId}, isInitiator: ${isInitiator}`);
    
    const peer = new RTCPeerConnection(iceServers);
    peers.set(userId, peer);
    
    // Yerel stream'i ekle
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`Adding ${track.kind} track to peer ${userId}`);
            peer.addTrack(track, localStream);
        });
    }
    
    // ICE candidate
    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: userId,
                candidate: event.candidate
            });
        }
    };
    
    // Uzak stream alındığında
    peer.ontrack = (event) => {
        console.log('Track alındı:', event.track.kind, 'from', userId);
        
        if (event.track.kind === 'audio') {
            let audioElement = document.getElementById(`audio-${userId}`);
            if (!audioElement) {
                audioElement = document.createElement('audio');
                audioElement.id = `audio-${userId}`;
                audioElement.autoplay = true;
                audioElement.muted = isSpeakerMuted;
                audioElement.volume = 1.0;
                document.body.appendChild(audioElement);
                console.log(`Audio element created for ${userId}`);
            }
            
            if (!audioElement.srcObject) {
                audioElement.srcObject = new MediaStream();
            }
            
            audioElement.srcObject.addTrack(event.track);
            
            // Ses çalmayı zorla
            audioElement.play()
                .then(() => console.log(`Audio playing for ${userId}`))
                .catch(e => console.error('Audio play error:', e));
                
        } else if (event.track.kind === 'video') {
            // Video track için remote video elementi oluştur
            let videoElement = document.getElementById(`video-${userId}`);
            if (!videoElement) {
                videoElement = document.createElement('video');
                videoElement.id = `video-${userId}`;
                videoElement.autoplay = true;
                videoElement.style.width = '100%';
                videoElement.style.borderRadius = '10px';
                videoElement.style.marginTop = '10px';
                document.getElementById('chat').appendChild(videoElement);
                console.log(`Video element created for ${userId}`);
            }
            
            if (!videoElement.srcObject) {
                videoElement.srcObject = new MediaStream();
            }
            
            videoElement.srcObject.addTrack(event.track);
        }
    };
    
    // Bağlantı durumu
    peer.onconnectionstatechange = () => {
        console.log(`Peer ${userId} durumu:`, peer.connectionState);
        if (peer.connectionState === 'connected') {
            console.log(`✅ Peer ${userId} bağlandı`);
        } else if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
            console.log(`❌ Peer ${userId} bağlantısı kesildi`);
            closePeerConnection(userId);
        }
    };
    
    // ICE bağlantı durumu
    peer.oniceconnectionstatechange = () => {
        console.log(`Peer ${userId} ICE durumu:`, peer.iceConnectionState);
    };
    
    // Başlatıcı ise offer gönder
    if (isInitiator) {
        setTimeout(() => {
            peer.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            })
                .then(offer => {
                    console.log(`Offer created for ${userId}`);
                    return peer.setLocalDescription(offer);
                })
                .then(() => {
                    socket.emit('offer', {
                        target: userId,
                        offer: peer.localDescription
                    });
                    console.log(`Offer sent to ${userId}`);
                })
                .catch(error => console.error('Offer oluşturma hatası:', error));
        }, 500); // Stream'in eklenmesi için kısa bir bekleme
    }
    
    return peer;
}

// Peer bağlantısını kapat
function closePeerConnection(userId) {
    const peer = peers.get(userId);
    if (peer) {
        peer.close();
        peers.delete(userId);
    }
    
    const audioElement = document.getElementById(`audio-${userId}`);
    if (audioElement) {
        audioElement.remove();
    }
    
    const videoElement = document.getElementById(`video-${userId}`);
    if (videoElement) {
        videoElement.remove();
    }
}

// Kullanıcı listesine ekle
function addUserToList(userId, userName) {
    const userlist = document.getElementById('userlist');
    
    if (!document.getElementById(`user-${userId}`)) {
        const userDiv = document.createElement('div');
        userDiv.id = `user-${userId}`;
        userDiv.className = 'user';
        userDiv.textContent = userName;
        userlist.appendChild(userDiv);
    }
}

// Kullanıcı listesinden çıkar
function removeUserFromList(userId) {
    const userDiv = document.getElementById(`user-${userId}`);
    if (userDiv) {
        userDiv.remove();
    }
}

// Kullanıcı sayısını güncelle
function updateUserCount() {
    const count = document.querySelectorAll('.user').length + 1; // +1 kendimiz
    document.getElementById('count').textContent = count;
}

// Durum güncelle
function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

// Mesaj gönder
function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    
    if (!message || !currentCode) {
        console.log('Mesaj gönderilemedi:', { message, currentCode, currentUser });
        return;
    }
    
    console.log('Mesaj gönderiliyor:', { roomCode: currentCode, userName: currentUser, message });
    
    // Kendi mesajımızı göster
    addMessage('Sen', message, true);
    
    // Sunucuya gönder
    socket.emit('chat-message', {
        roomCode: currentCode,
        userName: currentUser,
        message: message
    });
    
    input.value = '';
}

// Mesaj ekle
function addMessage(sender, text, isOwn) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;
    
    const senderSpan = document.createElement('div');
    senderSpan.className = 'sender';
    senderSpan.textContent = sender;
    
    const textSpan = document.createElement('div');
    textSpan.className = 'text';
    textSpan.textContent = text;
    
    messageDiv.appendChild(senderSpan);
    messageDiv.appendChild(textSpan);
    messagesDiv.appendChild(messageDiv);
    
    // Otomatik scroll
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Sistem mesajı ekle
function addSystemMessage(text) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';
    messageDiv.textContent = text;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
