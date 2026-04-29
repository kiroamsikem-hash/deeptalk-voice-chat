# VPS Kurulum Rehberi - DeepTalk Sunucusu

## 🔧 1. VPS Hazırlığı

### Sistem Gereksinimleri
- **İşletim Sistemi**: Ubuntu 20.04+ / CentOS 8+ / Debian 11+
- **RAM**: Minimum 1GB (2GB önerilen)
- **CPU**: 1 vCPU (2+ önerilen)
- **Disk**: 10GB boş alan
- **Bant Genişliği**: Sınırsız (ses trafiği için)

### Temel Paketleri Yükle
```bash
# Ubuntu/Debian için
sudo apt update && sudo apt upgrade -y
sudo apt install curl wget git nginx certbot python3-certbot-nginx -y

# CentOS/RHEL için
sudo yum update -y
sudo yum install curl wget git nginx certbot python3-certbot-nginx -y
```

## 🟢 2. Node.js Kurulumu

```bash
# Node.js 18.x kurulumu
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Kurulumu doğrula
node --version
npm --version
```

## 📁 3. Sunucu Dosyalarını Yükle

```bash
# Proje klasörü oluştur
mkdir -p /var/www/deeptalk
cd /var/www/deeptalk

# Dosyaları kopyala (vps-server.js ve vps-package.json)
# Bu dosyaları VPS'e yükleyin

# Bağımlılıkları yükle
npm install

# PM2 process manager yükle (opsiyonel ama önerilen)
sudo npm install -g pm2
```

## 🌐 4. DNS Ayarları

### Domain Sağlayıcınızda (qzz.io için):
```
A Record: deeptalk.qzz.io -> VPS_IP_ADRESI
```

### DNS Propagation Kontrolü:
```bash
# DNS'in yayılıp yayılmadığını kontrol et
nslookup deeptalk.qzz.io
dig deeptalk.qzz.io
```

## 🔒 5. SSL Sertifikası (Let's Encrypt)

```bash
# Nginx yapılandırması
sudo nano /etc/nginx/sites-available/deeptalk

# Aşağıdaki içeriği ekle:
server {
    listen 80;
    server_name deeptalk.qzz.io;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Site'ı aktifleştir
sudo ln -s /etc/nginx/sites-available/deeptalk /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL sertifikası al
sudo certbot --nginx -d deeptalk.qzz.io

# Otomatik yenileme ayarla
sudo crontab -e
# Şu satırı ekle:
0 12 * * * /usr/bin/certbot renew --quiet
```

## 🚀 6. Sunucuyu Başlat

### Geliştirme Modu:
```bash
cd /var/www/deeptalk
npm start
```

### Production Modu (PM2 ile):
```bash
cd /var/www/deeptalk

# HTTPS kullanmak için
export USE_HTTPS=true
export HTTPS_PORT=443
export HTTP_PORT=80

# PM2 ile başlat
pm2 start vps-server.js --name deeptalk-server

# PM2'yi sistem başlangıcına ekle
pm2 startup
pm2 save

# Logları görüntüle
pm2 logs deeptalk-server
```

## 🔥 7. Firewall Ayarları

```bash
# UFW (Ubuntu Firewall)
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3001/tcp
sudo ufw enable

# iptables (alternatif)
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 3001 -j ACCEPT
```

## 📊 8. Monitoring ve Loglar

### PM2 Komutları:
```bash
pm2 status                    # Durum kontrolü
pm2 logs deeptalk-server     # Logları görüntüle
pm2 restart deeptalk-server  # Yeniden başlat
pm2 stop deeptalk-server     # Durdur
pm2 delete deeptalk-server   # Sil
```

### Sunucu İstatistikleri:
```bash
# Tarayıcıda ziyaret edin:
https://deeptalk.qzz.io/stats
https://deeptalk.qzz.io/health
```

## 🔧 9. Nginx Yapılandırması (Tam Versiyon)

```nginx
# /etc/nginx/sites-available/deeptalk
server {
    listen 80;
    server_name deeptalk.qzz.io;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name deeptalk.qzz.io;

    ssl_certificate /etc/letsencrypt/live/deeptalk.qzz.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/deeptalk.qzz.io/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # Socket.IO için özel ayarlar
    location /socket.io/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

## ✅ 10. Test ve Doğrulama

### Bağlantı Testi:
```bash
# Sunucu çalışıyor mu?
curl https://deeptalk.qzz.io/health

# WebSocket bağlantısı test et
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: test" https://deeptalk.qzz.io/socket.io/
```

### Masaüstü Uygulamasından Test:
1. Uygulamayı başlatın
2. Kullanıcı adı ve oda adı girin
3. "Odaya Katıl" butonuna tıklayın
4. Bağlantı durumunu kontrol edin

## 🚨 11. Sorun Giderme

### Yaygın Sorunlar:

**1. DNS Yayılmadı:**
```bash
# 24 saat bekleyin veya DNS cache temizleyin
sudo systemctl flush-dns
```

**2. SSL Sertifikası Sorunu:**
```bash
sudo certbot renew --dry-run
sudo nginx -t
sudo systemctl reload nginx
```

**3. Port Erişim Sorunu:**
```bash
sudo netstat -tlnp | grep :3001
sudo ufw status
```

**4. PM2 Çalışmıyor:**
```bash
pm2 kill
pm2 start vps-server.js --name deeptalk-server
```

## 📞 12. Destek

Sorun yaşarsanız:
1. PM2 loglarını kontrol edin: `pm2 logs deeptalk-server`
2. Nginx loglarını kontrol edin: `sudo tail -f /var/log/nginx/error.log`
3. Sistem loglarını kontrol edin: `sudo journalctl -u nginx`

## 🎯 Özet Checklist

- [ ] VPS hazır ve güncel
- [ ] Node.js kurulu
- [ ] DNS A record ayarlandı (deeptalk.qzz.io -> VPS IP)
- [ ] Nginx kurulu ve yapılandırıldı
- [ ] SSL sertifikası alındı
- [ ] Sunucu dosyaları yüklendi
- [ ] PM2 ile sunucu başlatıldı
- [ ] Firewall ayarları yapıldı
- [ ] Test edildi ve çalışıyor

Bu adımları takip ettikten sonra **deeptalk.qzz.io** domain'iniz üzerinden sesli konuşma uygulamanız çalışacak!