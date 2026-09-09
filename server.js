const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Настройка Socket.io с подгонкой под большие файлы/буферы
const io = new Server(server, {
  maxHttpBufferSize: 1e8, // 100 MB для передачи медиа/файлов
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '100mb' }));

// Хранилища данных в памяти
const users = new Map(); // socket.id -> { id, username, status, room, joinedAt, avatar }
const privateMessages = new Map(); // conversationKey -> [messages]
const roomMessages = new Map(); // roomId -> [messages]
const activeCalls = new Map(); // callId -> { caller, receiver, type, startTime }

// Вспомогательная функция отправки списка онлайн-пользователей
function broadcastUsersList() {
  const usersList = Array.from(users.values()).map(u => ({
    socketId: u.socketId,
    username: u.username,
    status: u.status || 'online',
    room: u.room || 'general',
    avatar: u.avatar || null
  }));
  io.emit('users-list', usersList);
}

// Генерация ключа личных сообщений
function getPrivateChatKey(user1, user2) {
  return [user1, user2].sort().join('_');
}

io.on('connection', (socket) => {
  console.log(`[CONNECT] Новый сокет подключен: ${socket.id}`);

  // 1. АВТОРИЗАЦИЯ И СЕССИИ
  socket.on('register-user', (userData) => {
    try {
      const username = typeof userData === 'string' ? userData : userData?.username;
      if (!username) return;

      socket.username = username;
      socket.currentRoom = 'general';
      socket.join('general');

      users.set(socket.id, {
        socketId: socket.id,
        username: username,
        status: 'online',
        room: 'general',
        joinedAt: new Date().toISOString(),
        avatar: userData?.avatar || null
      });

      console.log(`[AUTH] Пользователь зарегистрирован: ${username} (${socket.id})`);

      // Системное сообщение в общий чат
      const sysMsg = {
        id: 'sys_' + Date.now(),
        user: 'Система',
        text: `Пользователь ${username} вошел в чат`,
        timestamp: new Date().toISOString(),
        isSystem: true
      };
      io.to('general').emit('chat message', sysMsg);

      broadcastUsersList();
    } catch (err) {
      console.error('[ERROR] register-user:', err);
    }
  });

  // Изменение статуса (Online, Away, DND)
  socket.on('change-status', (status) => {
    try {
      if (users.has(socket.id)) {
        users.get(socket.id).status = status;
        broadcastUsersList();
      }
    } catch (err) {
      console.error('[ERROR] change-status:', err);
    }
  });

  // 2. СООБЩЕНИЯ И ЧАТЫ
  socket.on('chat message', (data) => {
    try {
      if (!data || (!data.text && !data.file)) return;

      const payload = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        user: socket.username || data.user || 'Аноним',
        senderSocketId: socket.id,
        text: data.text || '',
        file: data.file || null, // { name, type, size, data }
        targetUser: data.targetUser || null,
        room: data.room || 'general',
        timestamp: new Date().toISOString()
      };

      // Если это личное сообщение
      if (data.targetUser) {
        const targetEntry = Array.from(users.entries()).find(([_, u]) => u.username === data.targetUser);
        
        // Сохраняем в историю лс
        const chatKey = getPrivateChatKey(socket.username, data.targetUser);
        if (!privateMessages.has(chatKey)) privateMessages.set(chatKey, []);
        privateMessages.get(chatKey).push(payload);

        // Отправляем получателю
        if (targetEntry) {
          io.to(targetEntry[0]).emit('private message', payload);
        }
        // Отправляем обратно отправителю для подтверждения
        socket.emit('private message', payload);
      } else {
        // Сообщение в комнату / общий чат
        const targetRoom = data.room || 'general';
        if (!roomMessages.has(targetRoom)) roomMessages.set(targetRoom, []);
        roomMessages.get(targetRoom).push(payload);

        io.to(targetRoom).emit('chat message', payload);
      }
    } catch (err) {
      console.error('[ERROR] chat message:', err);
    }
  });

  // Индикатор набора текста
  socket.on('typing', (data) => {
    try {
      if (data.targetUser) {
        const targetEntry = Array.from(users.entries()).find(([_, u]) => u.username === data.targetUser);
        if (targetEntry) {
          io.to(targetEntry[0]).emit('typing', { from: socket.username, isTyping: data.isTyping });
        }
      } else {
        socket.to(data.room || 'general').emit('typing', { from: socket.username, isTyping: data.isTyping });
      }
    } catch (err) {
      console.error('[ERROR] typing:', err);
    }
  });

  // Запрос истории сообщений
  socket.on('get-history', (data) => {
    try {
      if (data.targetUser) {
        const chatKey = getPrivateChatKey(socket.username, data.targetUser);
        const history = privateMessages.get(chatKey) || [];
        socket.emit('history-data', { targetUser: data.targetUser, messages: history });
      } else {
        const room = data.room || 'general';
        const history = roomMessages.get(room) || [];
        socket.emit('history-data', { room, messages: history });
      }
    } catch (err) {
      console.error('[ERROR] get-history:', err);
    }
  });

  // 3. WEBRTC ЗВОНКИ И ИНФРАСТРУКТУРА СИГНАЛИНГА
  socket.on('call-user', (data) => {
    try {
      if (!data || !data.targetUser) return;

      const targetEntry = Array.from(users.entries()).find(([_, u]) => u.username === data.targetUser);

      if (targetEntry) {
        const callId = 'call_' + Date.now();
        activeCalls.set(callId, {
          caller: socket.username,
          callerSocketId: socket.id,
          receiver: data.targetUser,
          receiverSocketId: targetEntry[0],
          isVideo: !!data.isVideo,
          status: 'ringing'
        });

        io.to(targetEntry[0]).emit('incoming-call', {
          callId: callId,
          from: socket.username,
          fromSocketId: socket.id,
          offer: data.offer,
          isVideo: !!data.isVideo
        });
      } else {
        socket.emit('call-failed', { reason: 'Пользователь не найдем или оффлайн' });
      }
    } catch (err) {
      console.error('[ERROR] call-user:', err);
      socket.emit('call-failed', { reason: 'Ошибка инициализации звонка на сервере' });
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
      console.error('[ERROR] make-answer:', err);
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
      console.error('[ERROR] ice-candidate:', err);
    }
  });

  socket.on('reject-call', (data) => {
    try {
      if (data && data.targetSocketId) {
        io.to(data.targetSocketId).emit('call-rejected', {
          from: socket.username,
          reason: 'Вызов отклонен пользователем'
        });
      }
    } catch (err) {
      console.error('[ERROR] reject-call:', err);
    }
  });

  socket.on('end-call', (data) => {
    try {
      if (data && data.targetSocketId) {
        io.to(data.targetSocketId).emit('call-ended', { from: socket.username });
      }
    } catch (err) {
      console.error('[ERROR] end-call:', err);
    }
  });

  // 4. ДИСКОННЕКТ И ОЧИСТКА
  socket.on('disconnect', () => {
    try {
      const u = users.get(socket.id);
      if (u) {
        console.log(`[DISCONNECT] Пользователь вышел: ${u.username} (${socket.id})`);
        
        // Уведомление в общий чат
        const sysMsg = {
          id: 'sys_' + Date.now(),
          user: 'Система',
          text: `Пользователь ${u.username} покинул чат`,
          timestamp: new Date().toISOString(),
          isSystem: true
        };
        io.to('general').emit('chat message', sysMsg);

        users.delete(socket.id);
        broadcastOnlineList();
      }
    } catch (err) {
      console.error('[ERROR] disconnect:', err);
    }
  });
});

// Глобальные обработчики для непрерывной работы сервера без вылетов (защита от 502 Bad Gateway)
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`  Сервер семейного чата успешно запущен!`);
  console.log(`  Порт: ${PORT}`);
  console.log(`===================================================`);
});
