class VoiceChatApp {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peers = new Map();
        this.isConnected = false;
        this.isMuted = false;
        this.isSpeakerMuted = false;
        this.currentRoom = null;
        this.currentUser = null;
        this.audioContext = null;
        this.analyser = null;
        this.micLevel = 0;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupElectronListeners();
        this.checkMicrophonePermission();
    }

    setupEventListeners() {
        // Giriş ekranı
        document.getElementById('join-btn').addEventListener('click', () => this.joinRoom());
        document.getElementById('username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        document.getElementById('room-id').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });

        // Ses kontrolleri
        document.getElementById('mute-btn').addEventListener('click', () => this.toggleMute());
        document.getElementById('speaker-btn').addEventListener('click', () => this.toggleSpeaker());
        document.getElementById('leave-btn').addEventListener('click', () => this.leaveRoom());

        // Ses ayarları
        document.getElementById('volume-slider').addEventListener('input', (e) => {
            this.setVolume(e.target.value / 100);
        });

        // Modal kontrolleri
        document.getElementById('close-audio-settings').addEventListener('click', () => {
            this.closeAudioSettings();
        });
        document.getElementById('save-audio-settings').addEventListener('click', () => {
            this.saveAudioSettings();
        });

        // Klavye kısayolları
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                this.toggleMute();
            }
        });
    }

    setupElectronListeners() {
        if (window.electronAPI) {
            // Menü olayları
            window.electronAPI.onNewRoom(() => {
                if (this.currentRoom) {
                    this.leaveRoom();
                }
                this.showScreen('login-screen');
            });

            window.electronAPI.onToggleMute(() => {
                this.toggleMute();
            });

            window.electronAPI.onAudioSettings(() => {
                this.showAudioSettings();
            });
        }
    }

    async checkMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            this.updateStatus('Mikrofon erişimi onaylandı');
        } catch (error) {
            this.updateStatus('Mikrofon erişimi gerekli', 'error');
            if (window.electronAPI) {
                window.electronAPI.showErrorDialog(
                    'Mikrofon Erişimi',
                    'Sesli konuşma için mikrofon erişimi gereklidir. Lütfen tarayıcı ayarlarından mikrofon iznini verin.'
                );
            }
        }
    }

    async joinRoom() {
        const username = document.getElementById('username').value.trim();
        const roomId = document.getElementById('room-id').value.trim();
        const serverUrl = 'https://deeptalk.qzz.io'; // Sabit sunucu adresi

        if (!username || !roomId) {
            this.updateStatus('Lütfen kullanıcı adı ve oda adı girin', 'error');
            return;
        }

        try {
            this.updateConnectionStatus('connecting', 'deeptalk.qzz.io\'ya bağlanıyor...');
            
            // Socket bağlantısı - HTTPS/WSS protokolü kullan
            this.socket = io(serverUrl, {
                transports: ['websocket', 'polling'],
                upgrade: true,
                rememberUpgrade: true,
                timeout: 15000,
                forceNew: true,
                autoConnect: true
            });
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.updateConnectionStatus('online', 'deeptalk.qzz.io\'ya bağlandı');
                this.currentUser = username;
                this.currentRoom = roomId;
                
                // Odaya katıl
                this.socket.emit('join-room', { roomId, userName: username });
                
                // Mikrofon başlat
                this.startAudio();
                
                // Ekranı değiştir
                this.showScreen('voice-screen');
                this.updateRoomInfo();
            });

            this.socket.on('disconnect', (reason) => {
                this.isConnected = false;
                this.updateConnectionStatus('offline', 'Bağlantı kesildi: ' + reason);
                console.log('Bağlantı kesildi:', reason);
            });

            this.socket.on('connect_error', (error) => {
                this.updateConnectionStatus('offline', 'Bağlantı hatası');
                this.updateStatus('deeptalk.qzz.io sunucusuna bağlanılamadı. İnternet bağlantınızı kontrol edin.', 'error');
                console.error('Bağlantı hatası:', error);
            });

            this.socket.on('reconnect', (attemptNumber) => {
                this.updateConnectionStatus('online', 'Yeniden bağlandı');
                console.log('Yeniden bağlandı, deneme:', attemptNumber);
            });

            this.socket.on('reconnect_attempt', (attemptNumber) => {
                this.updateConnectionStatus('connecting', `Yeniden bağlanıyor... (${attemptNumber})`);
            });

            // WebRTC olayları
            this.setupWebRTCListeners();

        } catch (error) {
            this.updateStatus('Bağlantı hatası: ' + error.message, 'error');
            this.updateConnectionStatus('offline', 'Bağlantı Hatası');
        }
    }

    setupWebRTCListeners() {
        this.socket.on('user-joined', (data) => {
            this.addParticipant(data.userId, data.userName);
            this.createPeerConnection(data.userId, true);
        });

        this.socket.on('existing-users', (users) => {
            users.forEach(user => {
                this.addParticipant(user.userId, user.userName);
                this.createPeerConnection(user.userId, false);
            });
        });

        this.socket.on('user-left', (data) => {
            this.removeParticipant(data.userId);
            if (this.peers.has(data.userId)) {
                this.peers.get(data.userId).close();
                this.peers.delete(data.userId);
            }
        });

        this.socket.on('offer', async (data) => {
            await this.handleOffer(data.offer, data.caller);
        });

        this.socket.on('answer', async (data) => {
            await this.handleAnswer(data.answer, data.answerer);
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data.candidate, data.sender);
        });
    }

    async startAudio() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1
                }
            });

            // Ses seviyesi analizi
            this.setupAudioAnalysis();
            
            this.updateStatus('Mikrofon aktif - Bağlantı kuruldu');
        } catch (error) {
            this.updateStatus('Mikrofon başlatılamadı: ' + error.message, 'error');
            
            // Mikrofon izni yoksa kullanıcıyı bilgilendir
            if (error.name === 'NotAllowedError') {
                if (window.electronAPI) {
                    window.electronAPI.showErrorDialog(
                        'Mikrofon İzni',
                        'Sesli konuşma için mikrofon iznine ihtiyaç var. Lütfen tarayıcı ayarlarından mikrofon iznini verin ve uygulamayı yeniden başlatın.'
                    );
                }
            }
        }
    }

    setupAudioAnalysis() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        source.connect(this.analyser);

        this.analyser.fftSize = 256;
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const updateLevel = () => {
            this.analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / bufferLength;
            this.micLevel = (average / 255) * 100;
            
            document.getElementById('mic-level').style.width = this.micLevel + '%';
            
            requestAnimationFrame(updateLevel);
        };
        updateLevel();
    }

    async createPeerConnection(userId, isInitiator) {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        };

        const peerConnection = new RTCPeerConnection(configuration);
        this.peers.set(userId, peerConnection);

        // Yerel stream ekle
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
        }

        // Uzak stream al
        peerConnection.ontrack = (event) => {
            const remoteStream = event.streams[0];
            this.playRemoteAudio(userId, remoteStream);
        };

        // ICE candidate
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            }
        };

        // Bağlantı durumu
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            console.log(`Peer ${userId} bağlantı durumu: ${state}`);
            this.updateParticipantStatus(userId, state);
            
            if (state === 'failed' || state === 'disconnected') {
                // Bağlantı başarısız olursa yeniden dene
                setTimeout(() => {
                    if (peerConnection.connectionState === 'failed') {
                        this.createPeerConnection(userId, isInitiator);
                    }
                }, 3000);
            }
        };

        // ICE bağlantı durumu
        peerConnection.oniceconnectionstatechange = () => {
            console.log(`Peer ${userId} ICE durumu: ${peerConnection.iceConnectionState}`);
        };

        if (isInitiator) {
            try {
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false
                });
                await peerConnection.setLocalDescription(offer);
                
                this.socket.emit('offer', {
                    target: userId,
                    offer: offer
                });
            } catch (error) {
                console.error('Offer oluşturma hatası:', error);
            }
        }
    }

    async handleOffer(offer, callerId) {
        const peerConnection = this.peers.get(callerId);
        if (!peerConnection) return;

        await peerConnection.setRemoteDescription(offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        this.socket.emit('answer', {
            target: callerId,
            answer: answer
        });
    }

    async handleAnswer(answer, answererId) {
        const peerConnection = this.peers.get(answererId);
        if (!peerConnection) return;

        await peerConnection.setRemoteDescription(answer);
    }

    async handleIceCandidate(candidate, senderId) {
        const peerConnection = this.peers.get(senderId);
        if (!peerConnection) return;

        await peerConnection.addIceCandidate(candidate);
    }

    playRemoteAudio(userId, stream) {
        let audioElement = document.getElementById(`audio-${userId}`);
        if (!audioElement) {
            audioElement = document.createElement('audio');
            audioElement.id = `audio-${userId}`;
            audioElement.autoplay = true;
            document.body.appendChild(audioElement);
        }
        audioElement.srcObject = stream;
    }

    toggleMute() {
        if (!this.localStream) return;

        this.isMuted = !this.isMuted;
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !this.isMuted;
        }

        const muteBtn = document.getElementById('mute-btn');
        const icon = muteBtn.querySelector('.icon');
        const text = muteBtn.querySelector('.text');

        if (this.isMuted) {
            muteBtn.classList.add('muted');
            icon.textContent = '🔇';
            text.textContent = 'Mikrofon Kapalı';
        } else {
            muteBtn.classList.remove('muted');
            icon.textContent = '🎤';
            text.textContent = 'Mikrofon Açık';
        }
    }

    toggleSpeaker() {
        this.isSpeakerMuted = !this.isSpeakerMuted;
        
        // Tüm uzak ses elementlerini sustur/aç
        document.querySelectorAll('audio[id^="audio-"]').forEach(audio => {
            audio.muted = this.isSpeakerMuted;
        });

        const speakerBtn = document.getElementById('speaker-btn');
        const icon = speakerBtn.querySelector('.icon');
        const text = speakerBtn.querySelector('.text');

        if (this.isSpeakerMuted) {
            speakerBtn.classList.add('speaker-muted');
            icon.textContent = '🔇';
            text.textContent = 'Hoparlör Kapalı';
        } else {
            speakerBtn.classList.remove('speaker-muted');
            icon.textContent = '🔊';
            text.textContent = 'Hoparlör Açık';
        }
    }

    setVolume(volume) {
        document.querySelectorAll('audio[id^="audio-"]').forEach(audio => {
            audio.volume = volume;
        });
        
        const speakerLevel = document.getElementById('speaker-level');
        speakerLevel.style.width = (volume * 100) + '%';
    }

    leaveRoom() {
        if (this.socket) {
            this.socket.disconnect();
        }

        // Tüm peer bağlantılarını kapat
        this.peers.forEach(peer => peer.close());
        this.peers.clear();

        // Yerel stream'i durdur
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Audio context'i kapat
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        // Ses elementlerini temizle
        document.querySelectorAll('audio[id^="audio-"]').forEach(audio => {
            audio.remove();
        });

        this.currentRoom = null;
        this.currentUser = null;
        this.isConnected = false;

        this.showScreen('login-screen');
        this.updateConnectionStatus('offline', 'Bağlantı Bekleniyor');
        this.clearParticipants();
    }

    addParticipant(userId, userName) {
        const participantsList = document.getElementById('participants-list');
        
        const participantDiv = document.createElement('div');
        participantDiv.className = 'participant';
        participantDiv.id = `participant-${userId}`;
        
        participantDiv.innerHTML = `
            <div class="participant-avatar">${userName.charAt(0).toUpperCase()}</div>
            <div class="participant-info">
                <div class="participant-name">${userName}</div>
                <div class="participant-status">Bağlandı</div>
            </div>
        `;
        
        participantsList.appendChild(participantDiv);
        this.updateParticipantCount();
    }

    removeParticipant(userId) {
        const participantElement = document.getElementById(`participant-${userId}`);
        if (participantElement) {
            participantElement.remove();
        }
        
        const audioElement = document.getElementById(`audio-${userId}`);
        if (audioElement) {
            audioElement.remove();
        }
        
        this.updateParticipantCount();
    }

    updateParticipantStatus(userId, status) {
        const participantElement = document.getElementById(`participant-${userId}`);
        if (participantElement) {
            const statusElement = participantElement.querySelector('.participant-status');
            const avatar = participantElement.querySelector('.participant-avatar');
            
            switch (status) {
                case 'connected':
                    statusElement.textContent = 'Bağlandı';
                    avatar.classList.remove('speaking');
                    break;
                case 'connecting':
                    statusElement.textContent = 'Bağlanıyor...';
                    break;
                case 'disconnected':
                    statusElement.textContent = 'Bağlantı Kesildi';
                    break;
            }
        }
    }

    updateParticipantCount() {
        const count = document.querySelectorAll('.participant').length;
        document.getElementById('participant-count').textContent = count;
    }

    clearParticipants() {
        document.getElementById('participants-list').innerHTML = '';
        this.updateParticipantCount();
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
    }

    updateRoomInfo() {
        document.getElementById('current-room').textContent = `Oda: ${this.currentRoom}`;
        document.getElementById('current-user').textContent = `Kullanıcı: ${this.currentUser}`;
    }

    updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('status');
        statusElement.textContent = message;
        statusElement.className = `status-message ${type}`;
    }

    updateConnectionStatus(status, text) {
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-text');
        
        statusDot.className = `status-dot ${status}`;
        statusText.textContent = text;
    }

    async showAudioSettings() {
        const modal = document.getElementById('audio-settings-modal');
        modal.classList.add('active');
        
        // Cihazları listele
        await this.loadAudioDevices();
    }

    closeAudioSettings() {
        const modal = document.getElementById('audio-settings-modal');
        modal.classList.remove('active');
    }

    async loadAudioDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            
            const micSelect = document.getElementById('mic-select');
            const speakerSelect = document.getElementById('speaker-select');
            
            micSelect.innerHTML = '';
            speakerSelect.innerHTML = '';
            
            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `${device.kind} ${device.deviceId.substr(0, 8)}`;
                
                if (device.kind === 'audioinput') {
                    micSelect.appendChild(option);
                } else if (device.kind === 'audiooutput') {
                    speakerSelect.appendChild(option);
                }
            });
        } catch (error) {
            console.error('Cihazlar yüklenemedi:', error);
        }
    }

    async saveAudioSettings() {
        // Ses ayarlarını kaydet
        const micId = document.getElementById('mic-select').value;
        const noiseSuppression = document.getElementById('noise-suppression').checked;
        const echoCancellation = document.getElementById('echo-cancellation').checked;
        
        if (micId && this.localStream) {
            try {
                // Yeni mikrofon stream'i al
                const newStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: micId,
                        echoCancellation: echoCancellation,
                        noiseSuppression: noiseSuppression,
                        autoGainControl: true
                    }
                });
                
                // Eski stream'i değiştir
                const audioTrack = newStream.getAudioTracks()[0];
                const oldTrack = this.localStream.getAudioTracks()[0];
                
                // Peer bağlantılarında track'i güncelle
                this.peers.forEach(peer => {
                    const sender = peer.getSenders().find(s => s.track === oldTrack);
                    if (sender) {
                        sender.replaceTrack(audioTrack);
                    }
                });
                
                // Eski track'i durdur
                oldTrack.stop();
                
                // Stream'i güncelle
                this.localStream.removeTrack(oldTrack);
                this.localStream.addTrack(audioTrack);
                
                this.updateStatus('Ses ayarları güncellendi');
            } catch (error) {
                this.updateStatus('Ses ayarları güncellenemedi: ' + error.message, 'error');
            }
        }
        
        this.closeAudioSettings();
    }
}

// Uygulamayı başlat
document.addEventListener('DOMContentLoaded', () => {
    new VoiceChatApp();
});