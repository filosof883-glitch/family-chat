const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Увеличиваем лимит размера сообщений для сокетов
const io = new Server(server, {
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

let users = {};

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  socket.on('register user', (username) => {
    users[socket.id] = username;
  });

  socket.on('chat message', (data) => {
    io.emit('chat message', data);
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
