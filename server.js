const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Отдача статики из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Карта пользователей: socketId -> { username, socketId }
const activeUsers = new Map();

// Функция рассылки актуального списка пользователей
function broadcastOnlineList() {
  const usersArray = Array.from(activeUsers.values());
  io.emit('users-list', usersArray);
}

io.on('connection', (socket) => {
  console.log(`[Socket] Новое подключение: ${socket.id}`);

  // Регистрация имени пользователя
  socket.on('register-user', (username) => {
    try {
      if (!username) return;
      socket.username = username;
      activeUsers.set(socket.id, { username, socketId: socket.id });
      console.log(`[Auth] Зарегистрирован: ${username} (${socket.id})`);
      broadcastOnlineList();
    } catch (err) {
      console.error('Ошибка при register-user:', err);
    }
  });

  // Обработка статус-индикатора "печатает..."
  socket.on('typing', (data) => {
    try {
      socket.broadcast.emit('typing', data);
    } catch (err) {
      console.error('Ошибка при typing:', err);
    }
  });

  // Обработка текстовых сообщений
  socket.on('chat message', (data) => {
    try {
      const payload = {
        id: Date.now().toString(),
        user: data.user || socket.username || 'Аноним',
        text: data.text || '',
        timestamp: new Date().toISOString()
      };
      io.emit('chat message', payload);
    } catch (err) {
      console.error('Ошибка при chat message:', err);
    }
  });

  // --- WEBRTC ЗВОНКИ ---
  socket.on('call-user', (data) => {
    try {
      if (!data || !data.targetUser) return;
      
      const targetEntry = Array.from(activeUsers.entries()).find(([_, u]) => u.username === data.targetUser);
      if (targetEntry) {
        io.to(targetEntry[0]).emit('incoming-call', {
          from: socket.username || 'Неизвестный',
          fromSocketId: socket.id,
          offer: data.offer,
          isVideo: !!data.isVideo
        });
      } else {
        socket.emit('call-failed', { reason: 'Пользователь не в сети' });
      }
    } catch (err) {
      console.error('Ошибка при call-user:', err);
    }
  });

  socket.on('make-answer', (data) => {
    try {
      if (data && data.targetSocketId) {
        io.to(data.targetSocketId).emit('call-answered', {
          fromSocketId: socket.id,
          answer: data.answer
        });
      }
    } catch (err) {
      console.error('Ошибка при make-answer:', err);
    }
  });

  socket.on('ice-candidate', (data) => {
    try {
      if (data && data.targetSocketId) {
        io.to(data.targetSocketId).emit('ice-candidate', {
          candidate: data.candidate,
          fromSocketId: socket.id
        });
      }
    } catch (err) {
      console.error('Ошибка при ice-candidate:', err);
    }
  });

  socket.on('end-call', (data) => {
    try {
      if (data && data.targetSocketId) {
        io.to(data.targetSocketId).emit('call-ended');
      }
    } catch (err) {
      console.error('Ошибка при end-call:', err);
    }
  });

  // Отключение клиента
  socket.on('disconnect', () => {
    try {
      activeUsers.delete(socket.id);
      broadcastOnlineList();
      console.log(`[Socket] Отключен: ${socket.id}`);
    } catch (err) {
      console.error('Ошибка при disconnect:', err);
    }
  });
});

// Предотвращение падения Node.js процесса (защита от 502 Bad Gateway)
process.on('uncaughtException', (err) => {
  console.error('КРИТИЧЕСКИЙ СБОЙ (uncaughtException):', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('КРИТИЧЕСКИЙ СБОЙ (unhandledRejection):', promise, 'причина:', reason);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер успешно запущен на порту ${PORT}`);
});
