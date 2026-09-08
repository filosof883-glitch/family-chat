// 1. Конфигурация с бесплатными STUN-серверами Google
const peerConnectionConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let peerConnection = null;
let localStream = null;
let currentTargetSocketId = null;

// Функция инициализации WebRTC
async function createPeerConnection(targetSocketId) {
  peerConnection = new RTCPeerConnection(peerConnectionConfig);
  currentTargetSocketId = targetSocketId;

  // Отправка кандидатов ICE через Socket.io
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentTargetSocketId) {
      socket.emit('ice-candidate', {
        targetSocketId: currentTargetSocketId,
        candidate: event.candidate
      });
    }
  };

  // Получение удаленного потока (аудио/видео)
  peerConnection.ontrack = (event) => {
    const remoteAudio = document.getElementById('remoteAudio'); // ваш <audio> элемент
    if (remoteAudio && remoteAudio.srcObject !== event.streams[0]) {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(e => console.error("Ошибка воспроизведения:", e));
    }
  };

  // Добавляем локальный микрофон/камеру
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }
}

// 2. Логика исходящего звонка
async function startCall(targetUsername, isVideo = false) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo
    });

    // Создаем соединение (socketId узнаем при отправке offer через сервер)
    peerConnection = new RTCPeerConnection(peerConnectionConfig);
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentTargetSocketId) {
        socket.emit('ice-candidate', {
          targetSocketId: currentTargetSocketId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.ontrack = (event) => {
      const remoteAudio = document.getElementById('remoteAudio');
      if (remoteAudio) remoteAudio.srcObject = event.streams[0];
    };

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Отправляем оффер на сервер
    socket.emit('call-user', {
      targetUser: targetUsername,
      offer: offer,
      isVideo: isVideo
    });

  } catch (err) {
    alert("Не удалось получить доступ к микрофону/камере: " + err.message);
  }
}

// 3. Обработка входящего звонка (на стороне Юли)
socket.on('incoming-call', async ({ from, fromSocketId, offer, isVideo }) => {
  currentTargetSocketId = fromSocketId; // Важно! Сохраняем ID того, кто звонит

  const accept = confirm(`Входящий звонок от ${from}. Принять?`);
  if (!accept) {
    socket.emit('end-call', { targetSocketId: fromSocketId });
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo
    });

    await createPeerConnection(fromSocketId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('make-answer', {
      targetSocketId: fromSocketId,
      answer: answer
    });
  } catch (err) {
    console.error("Ошибка при ответе на звонок:", err);
  }
});

// 4. Обработка ответа (на стороне Ильи)
socket.on('call-answered', async ({ fromSocketId, answer }) => {
  currentTargetSocketId = fromSocketId;
  if (peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }
});

// 5. Прием ICE-кандидатов
socket.on('ice-candidate', async ({ candidate }) => {
  if (peerConnection && candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.error("Ошибка добавления ICE кандидата", e);
    }
  }
});

// 6. Завершение звонка
socket.on('call-ended', () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  alert("Звонок завершен");
});
