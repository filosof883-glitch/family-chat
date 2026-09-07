const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const Datastore = require('nedb-promises');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = Datastore.create({ filename: './chat_messages.db', autoload: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

app.post('/api/login', (req, res) => {
  const { username } = req.body;
  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'Введите имя' });
  }
  req.session.username = username.trim();
  res.json({ success: true, username: req.session.username });
});

app.get('/api/me', (req, res) => {
  if (req.session.username) {
    res.json({ loggedIn: true, username: req.session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

io.on('connection', async (socket) => {
  const req = socket.request;
  const username = req.session ? req.session.username : null;

  try {
    const history = await db.find({}).sort({ timestamp: 1 }).limit(100);
    socket.emit('chat history', history);
  } catch (err) {
    console.error('Ошибка загрузки истории:', err);
  }

  socket.on('chat message', async (msgData) => {
    if (!username) return;

    const messageObj = {
      user: username,
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
