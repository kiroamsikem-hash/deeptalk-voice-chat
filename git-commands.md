# GitHub'a Yükleme Komutları

## 1. Git Repository'yi Başlat
```bash
git init
git add .
git commit -m "İlk commit: DeepTalk Sesli Konuşma Uygulaması"
```

## 2. GitHub Remote Ekle
```bash
git remote add origin https://github.com/kiroamsikem-hash/deeptalkal.git
```

## 3. Ana Branch Ayarla
```bash
git branch -M main
```

## 4. GitHub'a Push Et
```bash
git push -u origin main
```

## Tek Komutta Hepsi:
```bash
git init && git add . && git commit -m "İlk commit: DeepTalk Sesli Konuşma Uygulaması" && git remote add origin https://github.com/kiroamsikem-hash/deeptalkal.git && git branch -M main && git push -u origin main
```

## Sonraki Güncellemeler İçin:
```bash
git add .
git commit -m "Güncelleme açıklaması"
git push
```