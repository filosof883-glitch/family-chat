const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const ROOMS_FILE = path.join(__dirname, 'rooms.json');

// --- ЗАГРУЗКА И СОХРАНЕНИЕ ДАННЫХ ---
let messages = {}; // Структура: { "general": [...], "room_id": [...] }
if (fs.existsSync(MESSAGES_FILE)) {
  try {
    messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  } catch (err) {
    console.error('Ошибка чтения сообщений:', err);
  }
}

function saveMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения сообщений:', err);
  }
}

let registeredUsers = [];
if (fs.existsSync(USERS_FILE)) {
  try {
    registeredUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    console.error('Ошибка чтения пользователей:', err);
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(registeredUsers, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения пользователей:', err);
  }
}

let customRooms = []; // Групповые чаты: [{ id: 'group_123', name: 'Семья', members: ['Папа', 'Мама'] }]
if (fs.existsSync(ROOMS_FILE)) {
  try {
    customRooms = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
  } catch (err) {
    console.error('Ошибка чтения комнат:', err);
  }
}

function saveRooms() {
  try {
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(customRooms, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения комнат:', err);
  }
}

let activeSockets = {}; // socket.id -> username

function getUsersWithStatus() {
  const onlineUsernames = new Set(Object.values(activeSockets));
  return registeredUsers.map(username => ({
    username,
    online: onlineUsernames.has(username)
  }));
}

// Генерация уникального ID для личного чата двух людей (например "dm_Анна_Иван")
function getDirectRoomId(user1, user2) {
  return 'dm_' + [user1, user2].sort().join('_');
}

io.on('connection', (socket) => {
  console.log('Подключился сокет:', socket.id);

  socket.on('register user', (username) => {
    activeSockets[socket.id] = username;

    if (!registeredUsers.includes(username)) {
      registeredUsers.push(username);
      saveUsers();
    }

    // Автоматически подключаем пользователя во все его комнаты
    socket.join('general');
    customRooms.forEach(room => {
      if (room.members.includes(username)) {
        socket.join(room.id);
      }
    });

    // Оповещаем всех об обновлении пользователей
    io.emit('users list', getUsersWithStatus());
    sendUserRooms(username, socket);
  });

  // Получить историю конкретной комнаты
  socket.on('join room', (roomId) => {
    socket.join(roomId);
    const roomMessages = messages[roomId] || [];
    socket.emit('chat history', { roomId, messages: roomMessages });
  });

  // Создание группового чата
  socket.on('create group', ({ groupName, members }) => {
    const currentUser = activeSockets[socket.id];
    if (!members.includes(currentUser)) members.push(currentUser);

    const roomId = 'group_' + Date.now();
    const newRoom = { id: roomId, name: groupName, members };
    customRooms.push(newRoom);
    saveRooms();

    // Подключаем сокеты участников к комнате
    for (const [sId, uName] of Object.entries(activeSockets)) {
      if (members.includes(uName)) {
        const targetSocket = io.sockets.sockets.get(sId);
        if (targetSocket) {
          targetSocket.join(roomId);
          sendUserRooms(uName, targetSocket);
        }
      }
    }
  });

  // Отправка сообщения
  socket.on('chat message', (data) => {
    const { roomId, text, image, type, user } = data;
    
    // Подключаем сокет к приватной комнате, если он ещё не там
    socket.join(roomId);

    const messageData = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
      roomId,
      user,
      text,
      image,
      type,
      timestamp: new Date().toISOString()
    };

    if (!messages[roomId]) messages[roomId] = [];
    messages[roomId].push(messageData);
    if (messages[roomId].length > 200) messages[roomId] = messages[roomId].slice(-200);

    saveMessages();

    // Отправляем сообщение всем в этой комнате
    io.to(roomId).emit('chat message', messageData);
  });

  socket.on('delete message', ({ roomId, messageId }) => {
    if (messages[roomId]) {
      messages[roomId] = messages[roomId].filter(msg => msg.id !== messageId);
      saveMessages();
      io.to(roomId).emit('delete message', { roomId, messageId });
    }
  });

  // WebRTC Звонки
  socket.on('call-user', (data) => socket.broadcast.emit('incoming-call', data));
  socket.on('make-answer', (data) => socket.broadcast.emit('call-answered', data));
  socket.on('ice-candidate', (data) => socket.broadcast.emit('ice-candidate', data));
  socket.on('end-call', () => socket.broadcast.emit('call-ended'));

  socket.on('disconnect', () => {
    delete activeSockets[socket.id];
    io.emit('users list', getUsersWithStatus());
    console.log('Отключился сокет:', socket.id);
  });
});

function sendUserRooms(username, socket) {
  const userGroups = customRooms.filter(r => r.members.includes(username));
  socket.emit('user rooms', userGroups);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
