// game.js içindeki updatePlayer fonksiyonunu bu şekilde güncelleyin:
function updatePlayer(dt) {
  // 1. Yerçekimi ve Düşme Mantığı
  // Karakter yerdeyse dikey hızı (velocity.y) sıfırla veya çok küçük negatif bir değer yap ki yere yapışsın
  if (state.player.isGrounded) {
    if (state.player.velocity.y < 0) {
      state.player.velocity.y = -0.1; // Uçmayı/Süzülmeyi engellemek için yere bastırıyoruz
    }
    
    // Zıplama Kontrolü
    if (controls.jump) {
      state.player.velocity.y = JUMP_FORCE;
      state.player.isGrounded = false;
    }
  } else {
    // Havadaysa yerçekimi uygula
    state.player.velocity.y -= GRAVITY * dt;
  }

  // 2. Hareket Yönü Hesaplama
  const moveVector = new THREE.Vector3(0, 0, 0);
  if (controls.forward) moveVector.z -= 1;
  if (controls.backward) moveVector.z += 1;
  if (controls.left) moveVector.x -= 1;
  if (controls.right) moveVector.x += 1;
  moveVector.normalize();

  // Kameranın baktığı açıya göre yönü dönüştür (Y eksenini yok sayarak sadece yatayda hareket ettir)
  const camDirection = new THREE.Vector3();
  camera.getWorldDirection(camDirection);
  camDirection.y = 0;
  camDirection.normalize();

  const camRight = new THREE.Vector3(-camDirection.z, 0, camDirection.x);
  const finalMove = new THREE.Vector3()
    .addScaledVector(camDirection, -moveVector.z)
    .addScaledVector(camRight, moveVector.x)
    .normalize();

  // Hız çarpanları
  const currentSpeed = PLAYER_SPEED * (controls.sprint ? SPRINT_MULT : 1);
  
  // Yeni pozisyon adayını hesapla
  const nextPos = state.player.position.clone();
  nextPos.x += finalMove.x * currentSpeed * dt;
  nextPos.z += finalMove.z * currentSpeed * dt;
  nextPos.y += state.player.velocity.y * dt;

  // 3. Harita Sınırları ve Zemin (Toprak) Çarpışma Kontrolü
  const halfMap = MAP_SIZE / 2;
  nextPos.x = Math.max(-halfMap, Math.min(halfMap, nextPos.x));
  nextPos.z = Math.max(-halfMap, Math.min(halfMap, nextPos.z));

  // Zemin yüksekliğini al (Arazi/Toprak yüksekliği fonksiyonunuz)
  const terrainHeight = getTerrainHeight(nextPos.x, nextPos.z);
  
  // Karakterin basması gereken minimum Y koordinatı
  const groundLevel = terrainHeight + PLAYER_HEIGHT;

  // Eğer hesaplanan pozisyon yerin altına giriyorsa veya tam üstündeyse
  if (nextPos.y <= groundLevel + GROUND_SKIN) {
    nextPos.y = groundLevel; // Tam toprağa oturt
    state.player.velocity.y = 0;
    state.player.isGrounded = true;
  } else {
    // Eğer zemin seviyesinden yukarıdaysa havadadır
    state.player.isGrounded = false;
  }

  // Yapıların (İnşa edilen duvar/rampa) üzerindeki durma kontrolleri
  // Eğer oyununda yapılarla çarpışma kodu varsa bu bloktan sonra çalışmalıdır.
  checkStructureCollisions(nextPos);

  // Pozisyonu güncelle
  state.player.position.copy(nextPos);
  playerGroup.position.copy(state.player.position);

  // Kamerayı oyuncunun arkasına sabitle (3. Şahıs Görünümü)
  updateCamera();
}