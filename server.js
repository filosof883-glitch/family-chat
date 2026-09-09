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

// База данных в памяти
const activeUsers = new Map(); // socketId -> { socketId, username, joinedAt }
const messageHistory = []; // { id, from, to, text, timestamp, isPrivate }
const MAX_HISTORY = 200;

function broadcastOnlineList() {
  const usersArray = Array.from(activeUsers.values()).map(u => ({
    username: u.username,
    socketId: u.socketId,
    joinedAt: u.joinedAt
  }));
  io.emit('users-list', usersArray);
}

io.on('connection', (socket) => {
  console.log(`[Connect] Новое подключение: ${socket.id}`);

  // Регистрация пользователя
  socket.on('register-user', (username) => {
    try {
      if (!username || typeof username !== 'string') return;
      
      const cleanName = username.trim();
      socket.username = cleanName;
      
      activeUsers.set(socket.id, {
        socketId: socket.id,
        username: cleanName,
        joinedAt: new Date().toISOString()
      });

      console.log(`[Auth] Пользователь вошёл: ${cleanName} (${socket.id})`);
      
      // Отправляем подключившемуся историю общего чата
      const publicHistory = messageHistory.filter(m => !m.isPrivate);
      socket.emit('message-history', publicHistory);

      // Оповещаем остальных в общем чате
      socket.broadcast.emit('system-message', {
        id: Date.now().toString(),
        text: `Пользователь ${cleanName} вошёл в чат`,
        timestamp: new Date().toISOString()
      });

      broadcastOnlineList();
    } catch (err) {
      console.error('Ошибка register-user:', err);
    }
  });

  // Отправка текстовых и личных сообщений
  socket.on('chat message', (data) => {
    try {
      if (!data || !data.text || !data.text.trim()) return;

      const payload = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
        from: socket.username || data.user || 'Аноним',
        to: data.to || null, // null = общий чат
        text: data.text.trim(),
        isPrivate: !!data.to,
        timestamp: new Date().toISOString()
      };

      if (payload.isPrivate) {
        // Личное сообщение: ищем сокет получателя
        const targetEntry = Array.from(activeUsers.entries()).find(([_, u]) => u.username === payload.to);
        if (targetEntry) {
          // Отправляем получателю
          io.to(targetEntry[0]).emit('chat message', payload);
          // Отправляем себе обратно для подтверждения
          socket.emit('chat message', payload);
        } else {
          socket.emit('system-message', {
            id: Date.now().toString(),
            text: `Пользователь ${payload.to} не в сети. Сообщение не доставлено.`,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        // Сообщение в общий чат
        messageHistory.push(payload);
        if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
        io.emit('chat message', payload);
      }
    } catch (err) {
      console.error('Ошибка chat message:', err);
    }
  });

  // Индикатор статуса "печатает..."
  socket.on('typing-start', (data) => {
    try {
      if (data && data.to) {
        const targetEntry = Array.from(activeUsers.entries()).find(([_, u]) => u.username === data.to);
        if (targetEntry) {
          io.to(targetEntry[0]).emit('user-typing', { from: socket.username, isPrivate: true });
        }
      } else {
        socket.broadcast.emit('user-typing', { from: socket.username, isPrivate: false });
      }
    } catch (err) {
      console.error('Ошибка typing-start:', err);
    }
  });

  socket.on('typing-stop', (data) => {
    try {
      if (data && data.to) {
        const targetEntry = Array.from(activeUsers.entries()).find(([_, u]) => u.username === data.to);
        if (targetEntry) {
          io.to(targetEntry[0]).emit('user-stop-typing', { from: socket.username });
        }
      } else {
        socket.broadcast.emit('user-stop-typing', { from: socket.username });
      }
    } catch (err) {
      console.error('Ошибка typing-stop:', err);
    }
  });

  // --- WEBRTC СИГНАЛИНГ ---
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
        socket.emit('call-failed', { reason: 'Пользователь вышел из сети' });
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

  // Отключение
  socket.on('disconnect', () => {
    try {
      if (socket.username) {
        io.emit('system-message', {
          id: Date.now().toString(),
          text: `Пользователь ${socket.username} вышел из чата`,
          timestamp: new Date().toISOString()
        });
      }
      activeUsers.delete(socket.id);
      broadcastOnlineList();
      console.log(`[Disconnect] Отключен: ${socket.id}`);
    } catch (err) {
      console.error('Ошибка disconnect:', err);
    }
  });
});

process.on('uncaughtException', (err) => console.error('CRITICAL ERROR:', err));
process.on('unhandledRejection', (reason, p) => console.error('UNHANDLED PROMISE:', p, 'reason:', reason));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер работает на порту ${PORT}`));
