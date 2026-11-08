# playerify

Reklamsız, düşük kaynaklı, mekânsal dinleme odası. Rust + WebView2 ile yazılmış tek dosyalık native masaüstü uygulaması; arayüz yerel sunucudan yüklenir, Chrome/Edge penceresi açmaz.

## Çalıştırma

- `start.bat` → uygulamayı native WebView2 penceresinde açar.
- `stop.bat` → uygulamayı kapatır.
- Doğrudan `playerify.exe` de çalıştırılabilir.
- `playerify.exe --web` → arayüzü tarayıcıda açar.
- `playerify.exe --no-open` → yalnızca sunucuyu çalıştırır.

İlk çalıştırmada 7317 portu kullanılır; doluysa sıradaki boş porta geçer. Aynı anda ikinci kez açılırsa mevcut sunucuyu kullanır.

## Nereden müzik çekiyor?

Bu sürüm **yalnızca tam kayıt** çalar. 30 saniyelik önizlemeler kaldırıldı.

- **Audius**: tam uzunlukta, reklamsız, yüksek bit hızlı akış. Arama, keşfet ve tür sayfaları Audius kataloğundan gelir. 8D motoru ve stüdyo zinciri burada tam çalışır.
- **YouTube**: arama sonuçlarına YouTube kayıtları da katılır. Ses, `yt-dlp` ile çıkarılıp Playerify çalarında akar; 8D motoru, EQ ve tüm taşıma kontrolleri bu kaynakta da çalışır. Ses çıkarılamazsa aynı parça resmî YouTube gömülü oynatıcısına düşer. Arama sırasında iTunes/Deezer metadata'sı kullanılarak “şarkı + sanatçı” sorgusu kurulur, böylece kapak ve hızlandırılmış sürümler yerine orijinal kayıt üste çıkar. `yt-dlp` uygulamanın içine gömülüdür; ilk ses çıkarmada `%LOCALAPPDATA%\playerify\bin` altına açılır, ayrı dosya gerekmez (`YTDLP_PATH` ile harici sürüm zorlanabilir).
- **Yerel dosyalar**: `Dosya aç` veya sürükle-bırak. MP3, M4A, AAC, WAV, FLAC, OGG ve OPUS. Dosyalar tarayıcıdan çıkmaz, tam kalitede ve 8D zinciriyle çalar. Oturumluktur; uygulamayı kapatınca yeniden açman gerekir.
- **Spotify liste / albüm bağlantıları**: parçalar tek tek YouTube'da aranır; başlık, sanatçı ve süre kontrolünden geçen güvenilir eşleşmeler Playerify listesine eklenir. Kapak, remiks, live ve benzeri güvenilmez videolar eklenmez; gerekçeleri animasyonlu içe aktarma ekranında gösterilir. Liste kitaplığa kaydedilir ve tek tuşla çalınır.
- **Spotify şarkı / YouTube / Apple Music / Deezer bağlantıları**: bağlantı çözümlenir, şarkı adı ve sanatçı çıkarılır. Aynı şarkı önce Audius'ta, sonra YouTube'da aranır; bulunursa kendi çalarımızda tam uzunlukta ve 8D zinciriyle açılır. 30 sn önizleme çalınmaz.
- **Arama**: büyük/küçük harf, Türkçe karakterler, aksanlar ve yaygın yazım hataları tolere edilir. Şüpheli eşleşmelerde "Bunu mu demek istedin?" önerisi çıkar. Audius playlist kimlikleri alfanümerik olduğu için tüm topluluk listeleri açılır.

Spotify'ın ham sesi üçüncü taraf uygulamalara açık değildir; Playerify, Spotify parçalarını Audius veya YouTube üzerinden eşleştirerek çalar. Albüm/liste önizlemeleri ve eşleşmeyen kayıtlar resmî gömülü oynatıcıda açılır. Aynı durum Apple Music ve Deezer için de geçerlidir.

## Taşıma

- Release `playerify.exe` **tek dosyadır**: arayüz, `yt-dlp`, WebView2 kabuğu ve tüm varlıklar exe'nin içine gömülüdür.
- Statik CRT ile derlenir; Visual C++ Redistributable kurulu olmayan makinelerde de çalışır.
- Arayüz native WebView2 penceresinde açılır. WebView2 çalışma zamanı Windows 10/11'de hazırdır; yoksa tarayıcıya düşer.
- İlk YouTube çalımında gömülü `yt-dlp` `%LOCALAPPDATA%\playerify\bin` altına bir kez açılır; sonraki çalımlarda yeniden açılmaz.
- Kütüphane ve ayarlar `%LOCALAPPDATA%\playerify\state.json` içinde tutulur; WebView2 profili `%LOCALAPPDATA%\playerify\webview2`, tek örnek portu `%LOCALAPPDATA%\playerify\port` altındadır. Böylece tarayıcıdan native pencereye geçerken liste ve beğeniler korunur.

## Arayüz

- Üst gezinme çubuğu, cam paneller, sinematik günün kaydı sahnesi ve yüzen oyuncu dock'u.
- `F` ile tam ekran vinil odak sahnesi: dönen kapak, motor preset'leri, büyük taşıma kontrolleri ve kuyruk erişimi.
- Kartlar, satırlar, arama sonuçları ve modallar aynı Neon Orchid paletini kullanır; hareketler `data-motion` ayarına saygı duyar.

## Performans

- Görsel döngü oynatırken 30 fps, duraklatınca ~6 fps; pencere gizlenince tamamen durur.
- Sürekli çalışan blur/`backdrop-filter` ve hareketli arka plan kaldırıldı; cam görünümü statik gradyanlarla korunuyor.
- Orbit çizimi daha düşük DPR ve 30 fps ile sınırlandı; analizör okumaları duraklamada seyrekleştirildi.
- Bu makinede ölçüm (12 çekirdek): önce ~%16 sistem / ~2 çekirdek, sonra ~%1 sistem.

## Ses zinciri

Kaynak → yedi bant EQ → yapıştırıcı kompresör → 140 Hz Linkwitz-Riley crossover → bas merkezde kalır, orta/tiz uzamda hareket eder → prosedürel konvolüsyon odası → çıkış limiter’ı → 48 kHz float Web Audio.

- **Akıllı motor**: parçanın BPM’ine göre tur süresini hesaplar (32 vuruş), türe göre oda miktarını seçer, stereo genişliğe göre derinliği uyarlar. Akıllı modda gecikmesiz stereo yörünge kullanılır; HRTF yalnızca 8D/Yörünge modlarında devrededir. Varsayılan motordur.
- **8D / Yörünge / Gece / Bas**: elle seçilebilir modlar.
- **Kapalı**: tamamen düz, temiz zincir.

## Kaynak kullanımı

- Rust sunucusu boşta **~6-17 MB**, akış sırasında **~20 MB** RAM kullanır (ölçülen çalışma kümesi).
- Uygulama penceresi Chrome/Edge motorunu kullanır; bu ayrı bir süreç ağacıdır ve tarayıcı motorunun kendi bellek maliyeti vardır.
- Release exe `opt-level=z`, LTO, strip ve statik CRT ile derlenir; gömülü `yt-dlp` ile birlikte **~25 MB**.
- Yalnızca 2 tokio worker thread’i açılır, HTTP bağlantı havuzu ve bellek önbelleği sınırlıdır.

## Geliştirme

```bat
cargo run
cargo run -- --web
```

`cargo run` native WebView2 penceresini açar; `--web` tarayıcı modunu zorlar.

```bat
cargo build --release
```

Arayüz `frontend/` altında, derleme adımı yok. Sunucu statik dosyaları gömer; release exe tek başına çalışır. `yt-dlp.exe` yalnızca derleme sırasında gerekir: `include_bytes!` ile exe'ye gömülür, çalışma anında ayrı dosya aranmaz. `.cargo/config.toml` statik CRT'yi etkinleştirir.

## Lisans

MIT — bkz. [LICENSE](LICENSE).

## Klavye

- `Ctrl+K` komut paleti
- `Space` oynat/duraklat, `←/→` 5 sn, `Shift+←/→` 30 sn
- `↑/↓` ses, `M` sessiz, `L` beğen, `N` sonraki, `P` önceki
- `F` vinil odak sahnesi (şimdi çalıyor), `Q` kuyruk paneli
- `1` motor kapalı, `2` akıllı, `3` 8D, `4` yörünge, `5` gece, `6` bas
