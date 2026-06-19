# Battle Island 🏝️

Fortnite tarzı 3D battle royale oyunu. Tarayıcıda çalışır, kurulum gerektirmez.

**Güncel sürüm: 1.3.0**

## Nasıl Oynanır

1. `index.html` dosyasını bir tarayıcıda açın
2. Veya yerel sunucu ile çalıştırın:
   ```
   npx serve .
   ```
3. **OYNA** butonuna tıklayın

## GitHub Pages'e Yükleme

Eski sürüm görünüyorsa şu adımları izleyin:

1. **Tüm dosyaları güncelleyin** — `index.html`, `game.js`, `style.css` hepsi repo kökünde olmalı
2. **GitHub Pages ayarı** — Repo → Settings → Pages → Branch: `main`, Folder: `/ (root)`
3. **`.nojekyll` dosyası** repo kökünde olmalı (bu projede var)
4. Yükledikten sonra tarayıcıda **Ctrl+Shift+R** ile önbelleği temizleyin
5. Menüde **Sürüm 1.3.0** yazısını görüyorsan güncel sürümdesin

### Git ile yükleme

```bash
git init
git add .
git commit -m "Battle Island v1.3.0"
git branch -M main
git remote add origin https://github.com/KULLANICI/REPO.git
git push -u origin main --force
```

> Her güncellemede `index.html` içindeki `?v=1.3.0` sürüm numarasını artırın.

## Özellikler

- **Battle Royale** — 15 bot ile savaş, son ayakta kalan kazanır
- **İnşa Sistemi** — Duvar ve rampa inşa et (malzeme harcar)
- **2 Silah** — Assault Rifle ve Pompalı Tüfek
- **Fırtına** — Harita dışına çıkma, alan daralıyor
- **Loot** — Haritada malzeme, cephane ve kalkan topla
- **3. Şahıs Kamera** — Fortnite tarzı görünüm
- **Mobil Destek** — Dokunmatik kontroller
- **Çarpışma** — Ağaç, kaya ve binalara giremezsin

## Kontroller

| Tuş | İşlev |
|-----|-------|
| W | İleri |
| S | Geri |
| A | Sol |
| D | Sağ |
| Mouse | Bakış |
| Sol Tık | Ateş / İnşa |
| 1-4 | Silah / İnşa seç |
| Space | Zıpla |
| Shift | Koş |
| R | Yeniden doldur |
| E | Yakındaki loot'u topla |
| Q | Malzeme değiştir (tahta/taş/metal) |

## Teknoloji

- Three.js (3D grafik)
- Saf JavaScript (framework yok)
- CDN üzerinden modül import
