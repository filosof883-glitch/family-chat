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

app.use(express.static(path.join(__dirname, 'public')));

// Хранилище онлайн-пользователей: socketId -> { username, socketId }
const usersMap = new Map();

// Функция отправки обновленного списка всех пользователей всем клиентам
function broadcastUsersList() {
  const onlineList = Array.from(usersMap.values());
  io.emit('users-list', onlineList);
}

io.on('connection', (socket) => {
  console.log(`Подключился сокет: ${socket.id}`);

  // 1. Регистрация пользователя в сети
  socket.on('register-user', (username) => {
    try {
      if (!username) return;
      socket.username = username;
      usersMap.set(socket.id, { username, socketId: socket.id, online: true });
      console.log(`Пользователь ${username} вошел в чат`);
      broadcastUsersList();
    } catch (err) {
      console.error('Ошибка register-user:', err);
    }
  });

  // 2. Печать сообщения
  socket.on('typing', (data) => {
    try {
      socket.broadcast.emit('typing', data);
    } catch (err) {
      console.error('Ошибка typing:', err);
    }
  });

  // 3. Отправка сообщений
  socket.on('chat message', (data) => {
    try {
      const msgData = {
        ...data,
        id: Date.now().toString(),
        timestamp: new Date().toISOString()
      };
      io.emit('chat message', msgData);
    } catch (err) {
      console.error('Ошибка chat message:', err);
    }
  });

  // 4. WebRTC Звонки
  socket.on('call-user', (data) => {
    try {
      if (!data || !data.targetUser) return;
      const targetEntry = Array.from(usersMap.entries()).find(([_, u]) => u.username === data.targetUser);

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
      console.error('Ошибка call-user:', err);
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
      console.error('Ошибка make-answer:', err);
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
      console.error('Ошибка ice-candidate:', err);
    }
  });

  socket.on('end-call', (data) => {
    try {
      if (data && data.targetSocketId) {
        io.to(data.targetSocketId).emit('call-ended');
      }
    } catch (err) {
      console.error('Ошибка end-call:', err);
    }
  });

  // 5. Отключение
  socket.on('disconnect', () => {
    try {
      usersMap.delete(socket.id);
      broadcastUsersList();
      console.log(`Отключился сокет: ${socket.id}`);
    } catch (err) {
      console.error('Ошибка disconnect:', err);
    }
  });
});

process.on('uncaughtException', (err) => {
  console.error('КРИТИЧЕСКАЯ ОШИБКА:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('НЕОБРАБОТАННЫЙ PROMISE:', promise, 'причина:', reason);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер работает на порту ${PORT}`);
});
