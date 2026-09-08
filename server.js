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

// Обслуживание статических файлов из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище активных пользователей (socket.id -> user_data)
const users = new Map();

io.on('connection', (socket) => {
  console.log(`Пользователь подключился: ${socket.id}`);

  // Регистрация пользователя
  socket.on('register-user', (username) => {
    try {
      if (!username) return;
      socket.username = username;
      users.set(socket.id, { username, socketId: socket.id });
      
      // Оповещаем всех об обновлении списка онлайн-пользователей
      io.emit('users-list', Array.from(users.values()));
    } catch (err) {
      console.error('Ошибка при регистрации пользователя:', err);
    }
  });

  // --- WEBRTC ЗВОНКИ ---

  // Инициализация звонка
  socket.on('call-user', (data) => {
    try {
      if (!data || !data.targetUser) return;

      const targetEntry = Array.from(users.entries()).find(([_, u]) => u.username === data.targetUser);

      if (targetEntry && targetEntry[0]) {
        io.to(targetEntry[0]).emit('incoming-call', {
          from: socket.username || 'Неизвестный',
          fromSocketId: socket.id,
          offer: data.offer,
          isVideo: !!data.isVideo
        });
      } else {
        socket.emit('call-failed', { reason: 'Пользователь не в сети или недоступен' });
      }
    } catch (err) {
      console.error('Ошибка в call-user:', err);
    }
  });

  // Ответ на звонок
  socket.on('make-answer', (data) => {
    try {
      if (data && data.targetSocketId) {
        io.to(data.targetSocketId).emit('call-answered', {
          fromSocketId: socket.id,
          answer: data.answer
        });
      }
    } catch (err) {
      console.error('Ошибка в make-answer:', err);
    }
  });

  // Передача ICE-кандидатов
  socket.on('ice-candidate', (data) => {
    try {
      if (data && data.targetSocketId) {
        io.to(data.targetSocketId).emit('ice-candidate', {
          candidate: data.candidate,
          fromSocketId: socket.id
        });
      }
    } catch (err) {
      console.error('Ошибка в ice-candidate:', err);
    }
  });

  // Завершение звонка
  socket.on('end-call', (data) => {
    try {
      if (data && data.targetSocketId) {
        io.to(data.targetSocketId).emit('call-ended');
      }
    } catch (err) {
      console.error('Ошибка в end-call:', err);
    }
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    try {
      users.delete(socket.id);
      io.emit('users-list', Array.from(users.values()));
      console.log(`Пользователь отключился: ${socket.id}`);
    } catch (err) {
      console.error('Ошибка при отключении:', err);
    }
  });
});

// Глобальный перехват ошибок для предотвращения падения Node.js (код 502 на Render)
process.on('uncaughtException', (err) => {
  console.error('КРИТИЧЕСКАЯ ОШИБКА (uncaughtException):', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('НЕОБРАБОТАННЫЙ PROMISE (unhandledRejection):', promise, 'причина:', reason);
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
