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
        this.currentInviteCode = null;
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
        document.getElementById('join-btn').addEventListener('click', () => this.joinRoomWithCode());
        document.getElementById('create-room-btn').addEventListener('click', () => this.showCreateRoomScreen());
        
        // Oda oluşturma ekranı
        document.getElementById('create-room-confirm-btn').addEventListener('click', () => this.createRoom());
        document.getElementById('back-to-join-btn').addEventListener('click', () => this.showScreen('login-screen'));
        
        // Davet kodu ekranı
        document.getElementById('copy-code-btn').addEventListener('click', () => this.copyInviteCode());
        document.getElementById('enter-created-room-btn').addEventListener('click', () => this.enterCreatedRoom());
        document.getElementById('back-to-main-btn').addEventListener('click', () => this.showScreen('login-screen'));
        
        // Ana konuşma ekranı
        document.getElementById('copy-current-code-btn').addEventListener('click', () => this.copyCurrentInviteCode());

        // Enter tuşu ile form gönderme
        document.getElementById('username').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.focusNextInput();
        });
        document.getElementById('invite-code').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoomWithCode();
        });
        document.getElementById('room-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoomWithCode();
        });

        // Davet kodu input'u için otomatik büyük harf
        document.getElementById('invite-code').addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
            this.checkInviteCodeRequirements(e.target.value);
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

    generateInviteCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    showCreateRoomScreen() {
        this.showScreen('create-room-screen');
        document.getElementById('room-name').focus();
    }

    async createRoom() {
        const roomName = document.getElementById('room-name').value.trim();
        const roomPassword = document.getElementById('room-password-create').value.trim();
        const maxUsers = parseInt(document.getElementById('max-users').value);
        const username = document.getElementById('username').value.trim();

        if (!roomName) {
            this.updateStatus('Lütfen oda adını girin', 'error');
            return;
        }

        if (!username) {
            this.updateStatus('Lütfen kullanıcı adınızı girin', 'error');
            document.getElementById('username').focus();
            return;
        }

        const inviteCode = this.generateInviteCode();
        
        try {
            this.updateConnectionStatus('connecting', 'Oda oluşturuluyor...');
            
            // Socket bağlantısı
            this.socket = io('https://deeptalk.qzz.io', {
                transports: ['websocket', 'polling'],
                upgrade: true,
                rememberUpgrade: true,
                timeout: 15000,
                forceNew: true,
                autoConnect: true
            });
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.updateConnectionStatus('online', 'Bağlandı');
                
                // Oda oluştur
                this.socket.emit('create-room', {
                    inviteCode: inviteCode,
                    roomName: roomName,
                    password: roomPassword,
                    maxUsers: maxUsers,
                    creator: username
                });
            });

            this.socket.on('room-created', (data) => {
                this.currentInviteCode = inviteCode;
                this.showInviteCodeScreen(inviteCode, roomName, roomPassword, maxUsers);
            });

            this.socket.on('room-creation-failed', (data) => {
                this.updateStatus('Oda oluşturulamadı: ' + data.message, 'error');
                this.updateConnectionStatus('offline', 'Hata');
            });

            this.setupWebRTCListeners();

        } catch (error) {
            this.updateStatus('Bağlantı hatası: ' + error.message, 'error');
            this.updateConnectionStatus('offline', 'Bağlantı Hatası');
        }
    }

    showInviteCodeScreen(inviteCode, roomName, password, maxUsers) {
        document.getElementById('generated-invite-code').textContent = inviteCode;
        document.getElementById('created-room-name').textContent = roomName;
        document.getElementById('password-protected').textContent = password ? 'Evet' : 'Hayır';
        document.getElementById('max-users-display').textContent = maxUsers + ' Kişi';
        
        this.showScreen('invite-code-screen');
    }

    copyInviteCode() {
        const inviteCode = document.getElementById('generated-invite-code').textContent;
        navigator.clipboard.writeText(inviteCode).then(() => {
            const btn = document.getElementById('copy-code-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="btn-icon">✅</span>Kopyalandı!';
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 2000);
        });
    }

    copyCurrentInviteCode() {
        if (this.currentInviteCode) {
            navigator.clipboard.writeText(this.currentInviteCode).then(() => {
                const btn = document.getElementById('copy-current-code-btn');
                btn.textContent = '✅';
                setTimeout(() => {
                    btn.textContent = '📋';
                }, 2000);
            });
        }
    }

    enterCreatedRoom() {
        const username = document.getElementById('username').value.trim();
        this.currentUser = username;
        this.joinRoomDirectly(this.currentInviteCode);
    }

    checkInviteCodeRequirements(code) {
        // Davet kodu girildiğinde şifre alanını göster/gizle
        const passwordGroup = document.getElementById('password-group');
        if (code.length >= 4) {
            // Sunucudan oda bilgilerini al
            this.checkRoomRequirements(code);
        } else {
            passwordGroup.style.display = 'none';
        }
    }

    checkRoomRequirements(inviteCode) {
        // Geçici olarak şifre alanını göster
        // Gerçek uygulamada sunucudan oda bilgilerini alacağız
        const passwordGroup = document.getElementById('password-group');
        passwordGroup.style.display = 'block';
    }

    async joinRoomWithCode() {
        const username = document.getElementById('username').value.trim();
        const inviteCode = document.getElementById('invite-code').value.trim();
        const roomPassword = document.getElementById('room-password').value.trim();

        if (!username || !inviteCode) {
            this.updateStatus('Lütfen kullanıcı adı ve davet kodu girin', 'error');
            return;
        }

        if (inviteCode.length < 4) {
            this.updateStatus('Davet kodu en az 4 karakter olmalıdır', 'error');
            return;
        }

        this.joinRoomDirectly(inviteCode, roomPassword);
    }

    async joinRoomDirectly(inviteCode, password = '') {
        const username = document.getElementById('username').value.trim();
        
        try {
            this.updateConnectionStatus('connecting', 'Odaya bağlanıyor...');
            
            if (!this.socket || !this.isConnected) {
                // Socket bağlantısı
                this.socket = io('https://deeptalk.qzz.io', {
                    transports: ['websocket', 'polling'],
                    upgrade: true,
                    rememberUpgrade: true,
                    timeout: 15000,
                    forceNew: true,
                    autoConnect: true
                });
                
                this.socket.on('connect', () => {
                    this.isConnected = true;
                    this.updateConnectionStatus('online', 'Bağlandı');
                    this.attemptJoinRoom(inviteCode, username, password);
                });
            } else {
                this.attemptJoinRoom(inviteCode, username, password);
            }

            this.setupWebRTCListeners();

        } catch (error) {
            this.updateStatus('Bağlantı hatası: ' + error.message, 'error');
            this.updateConnectionStatus('offline', 'Bağlantı Hatası');
        }
    }

    attemptJoinRoom(inviteCode, username, password) {
        this.socket.emit('join-room-by-code', {
            inviteCode: inviteCode,
            userName: username,
            password: password
        });

        this.socket.on('room-joined', (data) => {
            this.currentUser = username;
            this.currentRoom = data.roomName;
            this.currentInviteCode = inviteCode;
            
            // Mikrofon başlat
            this.startAudio();
            
            // Ekranı değiştir
            this.showScreen('voice-screen');
            this.updateRoomInfo();
        });

        this.socket.on('room-join-failed', (data) => {
            this.updateStatus('Odaya katılım başarısız: ' + data.message, 'error');
            this.updateConnectionStatus('offline', 'Hata');
        });

        this.socket.on('disconnect', (reason) => {
            this.isConnected = false;
            this.updateConnectionStatus('offline', 'Bağlantı kesildi: ' + reason);
        });

        this.socket.on('connect_error', (error) => {
            this.updateConnectionStatus('offline', 'Bağlantı hatası');
            this.updateStatus('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.', 'error');
        });
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

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
        }

        peerConnection.ontrack = (event) => {
            const remoteStream = event.streams[0];
            this.playRemoteAudio(userId, remoteStream);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            }
        };

        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            this.updateParticipantStatus(userId, state);
            
            if (state === 'failed' || state === 'disconnected') {
                setTimeout(() => {
                    if (peerConnection.connectionState === 'failed') {
                        this.createPeerConnection(userId, isInitiator);
                    }
                }, 3000);
            }
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

        this.peers.forEach(peer => peer.close());
        this.peers.clear();

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        document.querySelectorAll('audio[id^="audio-"]').forEach(audio => {
            audio.remove();
        });

        this.currentRoom = null;
        this.currentUser = null;
        this.currentInviteCode = null;
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
        document.getElementById('current-user').textContent = `Kullanıcı: ${this.currentUser}`;
        document.getElementById('current-room-name').textContent = this.currentRoom || '-';
        document.getElementById('current-invite-code').textContent = this.currentInviteCode || '-';
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

    focusNextInput() {
        document.getElementById('invite-code').focus();
    }

    async showAudioSettings() {
        const modal = document.getElementById('audio-settings-modal');
        modal.classList.add('active');
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
        const micId = document.getElementById('mic-select').value;
        const noiseSuppression = document.getElementById('noise-suppression').checked;
        const echoCancellation = document.getElementById('echo-cancellation').checked;
        
        if (micId && this.localStream) {
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: micId,
                        echoCancellation: echoCancellation,
                        noiseSuppression: noiseSuppression,
                        autoGainControl: true
                    }
                });
                
                const audioTrack = newStream.getAudioTracks()[0];
                const oldTrack = this.localStream.getAudioTracks()[0];
                
                this.peers.forEach(peer => {
                    const sender = peer.getSenders().find(s => s.track === oldTrack);
                    if (sender) {
                        sender.replaceTrack(audioTrack);
                    }
                });
                
                oldTrack.stop();
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