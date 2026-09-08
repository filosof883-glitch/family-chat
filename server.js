const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Увеличиваем лимит размера сообщений для сокетов до 50MB
const io = new Server(server, {
  maxHttpBufferSize: 50 * 1024 * 1024
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Путь к файлу с историей сообщений
const DATA_FILE = path.join(__dirname, 'messages.json');

// Загрузка сохраненных сообщений из файла при старте
let messages = [];
if (fs.existsSync(DATA_FILE)) {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    messages = JSON.parse(data);
  } catch (err) {
    console.error('Ошибка чтения файла сообщений:', err);
    messages = [];
  }
}

// Функция сохранения сообщений в файл
function saveMessages() {
  try {
    // Храним последние 200 сообщений
    if (messages.length > 200) {
      messages = messages.slice(-200);
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения сообщений:', err);
  }
}

let users = {};

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  // При подключении отправляем пользователю всю накопленную историю
  socket.emit('chat history', messages);

  socket.on('register user', (username) => {
    users[socket.id] = username;
  });

  socket.on('chat message', (data) => {
    // Добавляем уникальный ID и метку времени к сообщению
    const messageData = {
      ...data,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString()
    };

    messages.push(messageData);
    saveMessages(); // Сохраняем на диск

    io.emit('chat message', messageData);
  });

  // НОВОЕ: Обработчик удаления сообщения
  socket.on('delete message', (messageId) => {
    // Удаляем сообщение из массива истории
    messages = messages.filter(msg => msg.id !== messageId);
    saveMessages(); // Обновляем файл
    
    // Рассылаем всем клиентам команду убрать сообщение с экрана
    io.emit('delete message', messageId);
  });

  // Логика звонков WebRTC
  socket.on('call-user', (data) => {
    socket.broadcast.emit('incoming-call', data);
  });

  socket.on('make-answer', (data) => {
    socket.broadcast.emit('call-answered', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.broadcast.emit('ice-candidate', data);
  });

  socket.on('end-call', () => {
    socket.broadcast.emit('call-ended');
  });

  socket.on('disconnect', () => {
    delete users[socket.id];
    console.log('Пользователь отключился:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
