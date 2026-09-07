const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const Datastore = require('nedb-promises');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10 MB
});

const db = Datastore.create({ filename: './chat_messages.db', autoload: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: 'family-secret-key-12345',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Отслеживание подключенных пользователей
const onlineUsers = new Map();

io.on('connection', async (socket) => {
  const req = socket.request;
  const username = req.session ? req.session.username : null;

  try {
    const history = await db.find({}).sort({ timestamp: 1 }).limit(100);
    socket.emit('chat history', history);
  } catch (err) {
    console.error('Ошибка загрузки истории:', err);
  }

  socket.on('register user', (user) => {
    socket.username = user;
    onlineUsers.set(user, socket.id);
  });

  socket.on('chat message', async (msgData) => {
    const sender = username || msgData.user || 'Аноним';
    const messageObj = {
      user: sender,
      text: msgData.text || '',
      type: msgData.type || 'text',
      timestamp: new Date().getTime()
    };

    try {
      const savedMsg = await db.insert(messageObj);
      io.emit('chat message', savedMsg);
    } catch (err) {
      console.error('Ошибка сохранения:', err);
    }
  });

  // --- WebRTC Сигналинг для Звонков ---
  socket.on('call-user', (data) => {
    io.emit('incoming-call', {
      from: data.from,
      offer: data.offer,
      isVideo: data.isVideo
    });
  });

  socket.on('answer-call', (data) => {
    io.emit('call-answered', {
      answer: data.answer
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.broadcast.emit('ice-candidate', data.candidate);
  });

  socket.on('end-call', () => {
    io.emit('call-ended');
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
    }
  });
});

app.post('/api/login', (req, res) => {
  const { username } = req.body;
  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'Введите имя' });
  }
  req.session.username = username.trim();
  res.json({ success: true, username: req.session.username });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.username) {
    res.json({ loggedIn: true, username: req.session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
