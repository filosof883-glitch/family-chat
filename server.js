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

// --- ЗАГРУЗКА И СОХРАНЕНИЕ СООБЩЕНИЙ ---
let messages = [];
if (fs.existsSync(MESSAGES_FILE)) {
  try {
    messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  } catch (err) {
    console.error('Ошибка чтения сообщений:', err);
  }
}

function saveMessages() {
  try {
    if (messages.length > 200) messages = messages.slice(-200);
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения сообщений:', err);
  }
}

// --- ЗАГРУЗКА И СОХРАНЕНИЕ ПОЛЬЗОВАТЕЛЕЙ ---
let registeredUsers = []; // Список всех имен [ "Папа", "Мама", "Саша" ]
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

// Карта активных подключений: socket.id -> username
let activeSockets = {};

// Функция генерации списка пользователей со статусами
function getUsersWithStatus() {
  const onlineUsernames = new Set(Object.values(activeSockets));
  return registeredUsers.map(username => ({
    username,
    online: onlineUsernames.has(username)
  }));
}

io.on('connection', (socket) => {
  console.log('Подключился сокет:', socket.id);

  // Отправляем историю сообщений и список пользователей новому клиенту
  socket.emit('chat history', messages);
  socket.emit('users list', getUsersWithStatus());

  // Регистрация / вход пользователя
  socket.on('register user', (username) => {
    activeSockets[socket.id] = username;

    if (!registeredUsers.includes(username)) {
      registeredUsers.push(username);
      saveUsers();
    }

    // Оповещаем всех об изменении статусов
    io.emit('users list', getUsersWithStatus());
  });

  socket.on('chat message', (data) => {
    const messageData = {
      ...data,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString()
    };

    messages.push(messageData);
    saveMessages();
    io.emit('chat message', messageData);
  });

  socket.on('delete message', (messageId) => {
    messages = messages.filter(msg => msg.id !== messageId);
    saveMessages();
    io.emit('delete message', messageId);
  });

  // WebRTC звонки
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
