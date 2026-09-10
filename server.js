const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройка Socket.io с защитой от разрывов Render и поддержкой больших файлов
const io = new Server(server, {
  maxHttpBufferSize: 1e8, // 100 MB
  pingTimeout: 30000,
  pingInterval: 10000,
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '100mb' }));

// Хранилища данных в памяти (Привязка по username!)
const users = new Map(); // username -> { username, status, room, avatar, sockets: Set }
const privateMessages = new Map(); // conversationKey -> [messages]
const roomMessages = new Map(); // roomId -> [messages]

// Рассылка актуального списка пользователей
function broadcastUsersList() {
  const usersList = Array.from(users.values()).map(u => ({
    username: u.username,
    status: u.status || 'online',
    room: u.room || 'general',
    avatar: u.avatar || null
  }));
  io.emit('users-list', usersList);
}

function getPrivateChatKey(user1, user2) {
  return [user1, user2].sort().join('_');
}

io.on('connection', (socket) => {
  console.log(`[CONNECT] Сокет подключен: ${socket.id}`);

  // 1. АВТОРИЗАЦИЯ И СЕССИИ
  socket.on('register-user', (userData) => {
    try {
      const username = typeof userData === 'string' ? userData : userData?.username;
      if (!username) return;

      socket.username = username;
      socket.currentRoom = 'general';

      // Входим в общую комнату и создаем персональную комнату по имени пользователя
      socket.join('general');
      socket.join(username);

      if (!users.has(username)) {
        users.set(username, {
          username: username,
          status: 'online',
          room: 'general',
          avatar: userData?.avatar || null,
          sockets: new Set([socket.id])
        });

        // Системное сообщение только при первом входе
        io.to('general').emit('chat message', {
          id: 'sys_' + Date.now(),
          user: 'Система',
          text: `Пользователь ${username} вошел в чат`,
          timestamp: new Date().toISOString(),
          isSystem: true
        });
      } else {
        // У пользователя открыто несколько вкладок или произошел реконнект
        const u = users.get(username);
        u.sockets.add(socket.id);
        u.status = 'online';
      }

      console.log(`[AUTH] ${username} в сети (Сокетов: ${users.get(username).sockets.size})`);
      broadcastUsersList();
    } catch (err) {
      console.error('[ERROR] register-user:', err);
    }
  });

  // Изменение статуса (Online, Away, DND)
  socket.on('change-status', (status) => {
    try {
      if (socket.username && users.has(socket.username)) {
        users.get(socket.username).status = status;
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

      const sender = socket.username || data.user || 'Аноним';
      const payload = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        user: sender,
        text: data.text || '',
        file: data.file || null,
        targetUser: data.targetUser || null,
        room: data.room || 'general',
        timestamp: new Date().toISOString()
      };

      if (data.targetUser) {
        // ЛИЧНОЕ СООБЩЕНИЕ: Отправка напрямую в персональные комнаты получателя и отправителя
        const chatKey = getPrivateChatKey(sender, data.targetUser);
        if (!privateMessages.has(chatKey)) privateMessages.set(chatKey, []);
        privateMessages.get(chatKey).push(payload);

        io.to(data.targetUser).emit('private message', payload);
        if (sender !== data.targetUser) {
          io.to(sender).emit('private message', payload);
        }
      } else {
        // СООБЩЕНИЕ В ОБЩИЙ ЧАТ
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
        io.to(data.targetUser).emit('typing', { from: socket.username, isTyping: data.isTyping });
      } else {
        socket.to(data.room || 'general').emit('typing', { from: socket.username, isTyping: data.isTyping });
      }
    } catch (err) {
      console.error('[ERROR] typing:', err);
    }
  });

  // История сообщений
  socket.on('get-history', (data) => {
    try {
      if (data.targetUser) {
        const chatKey = getPrivateChatKey(socket.username, data.targetUser);
        socket.emit('history-data', { targetUser: data.targetUser, messages: privateMessages.get(chatKey) || [] });
      } else {
        const room = data.room || 'general';
        socket.emit('history-data', { room, messages: roomMessages.get(room) || [] });
      }
    } catch (err) {
      console.error('[ERROR] get-history:', err);
    }
  });

  // 3. WEBRTC ЗВОНКИ
  socket.on('call-user', (data) => {
    try {
      if (!data || !data.targetUser) return;
      
      if (users.has(data.targetUser)) {
        const callId = 'call_' + Date.now();
        io.to(data.targetUser).emit('incoming-call', {
          callId: callId,
          from: socket.username,
          offer: data.offer,
          isVideo: !!data.isVideo
        });
      } else {
        socket.emit('call-failed', { reason: 'Пользователь не найден или оффлайн' });
      }
    } catch (err) {
      console.error('[ERROR] call-user:', err);
    }
  });

  socket.on('make-answer', (data) => {
    if (data && data.targetUser) {
      io.to(data.targetUser).emit('call-answered', { from: socket.username, answer: data.answer });
    }
  });

  socket.on('ice-candidate', (data) => {
    if (data && data.targetUser) {
      io.to(data.targetUser).emit('ice-candidate', { candidate: data.candidate, from: socket.username });
    }
  });

  socket.on('reject-call', (data) => {
    if (data && data.targetUser) {
      io.to(data.targetUser).emit('call-rejected', { from: socket.username, reason: 'Вызов отклонен' });
    }
  });

  socket.on('end-call', (data) => {
    if (data && data.targetUser) {
      io.to(data.targetUser).emit('call-ended', { from: socket.username });
    }
  });

  // 4. ДИСКОННЕКТ
  socket.on('disconnect', () => {
    try {
      const username = socket.username;
      if (username && users.has(username)) {
        const u = users.get(username);
        u.sockets.delete(socket.id);

        // Переводим пользователя в оффлайн только если у него не осталось активных сокетов
        if (u.sockets.size === 0) {
          users.delete(username);
          console.log(`[DISCONNECT] ${username} вышел из сети`);

          io.to('general').emit('chat message', {
            id: 'sys_' + Date.now(),
            user: 'Система',
            text: `Пользователь ${username} покинул чат`,
            timestamp: new Date().toISOString(),
            isSystem: true
          });

          broadcastUsersList();
        }
      }
    } catch (err) {
      console.error('[ERROR] disconnect:', err);
    }
  });
});

process.on('uncaughtException', (err) => console.error('[CRITICAL] Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('[CRITICAL] Unhandled Rejection:', reason));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер семейного чата запущен на порту ${PORT}`));
