const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10MB для картинок
});

app.use(express.static(path.join(__dirname, 'public')));

// База данных в памяти
const roomsMessages = {
  general: []
};
const users = new Map(); // socket.id -> { username, online }
const groups = []; // [{ id, name, members }]

io.on('connection', (socket) => {
  socket.on('register user', (username) => {
    socket.username = username;
    users.set(socket.id, { username, online: true });
    
    // Рассылаем список пользователей
    broadcastUsers();
    // Отправляем группы пользователя
    sendUserGroups(socket);
  });

  socket.on('join room', (roomId) => {
    socket.leaveAll();
    socket.join(roomId);
    
    if (!roomsMessages[roomId]) {
      roomsMessages[roomId] = [];
    }
    
    socket.emit('chat history', {
      roomId,
      messages: roomsMessages[roomId]
    });
  });

  socket.on('chat message', (data) => {
    const { roomId, user, text, image, type } = data;
    const msg = {
      id: String(Date.now() + Math.random().toString(36).substr(2, 5)),
      roomId,
      user,
      text: text || '',
      image: image || null,
      type: type || 'text',
      timestamp: new Date().toISOString(),
      reactions: {}
    };

    if (!roomsMessages[roomId]) roomsMessages[roomId] = [];
    roomsMessages[roomId].push(msg);

    io.to(roomId).emit('chat message', msg);
  });

  socket.on('toggle reaction', ({ roomId, messageId, emoji, user }) => {
    const strId = String(messageId);
    const messages = roomsMessages[roomId] || [];
    const msg = messages.find(m => String(m.id) === strId);

    if (msg) {
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

      const index = msg.reactions[emoji].indexOf(user);
      if (index > -1) {
        msg.reactions[emoji].splice(index, 1);
        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
      } else {
        msg.reactions[emoji].push(user);
      }

      io.to(roomId).emit('update reaction', {
        roomId,
        messageId: strId,
        reactions: msg.reactions
      });
    }
  });

  socket.on('delete message', ({ roomId, messageId }) => {
    const strId = String(messageId);
    if (roomsMessages[roomId]) {
      roomsMessages[roomId] = roomsMessages[roomId].filter(m => String(m.id) !== strId);
      io.to(roomId).emit('delete message', { roomId, messageId: strId });
    }
  });

  socket.on('create group', ({ groupName, members }) => {
    const groupId = 'group_' + Date.now();
    const allMembers = Array.from(new Set([...members, socket.username]));
    const newGroup = { id: groupId, name: groupName, members: allMembers };
    
    groups.push(newGroup);
    roomsMessages[groupId] = [];

    // Уведомляем участников
    for (let [sId, u] of users.entries()) {
      if (allMembers.includes(u.username)) {
        const userSocket = io.sockets.sockets.get(sId);
        if (userSocket) sendUserGroups(userSocket);
      }
    }
  });

  socket.on('typing', ({ roomId, username, isTyping }) => {
    socket.to(roomId).emit('typing', { roomId, username, isTyping });
  });

  // --- WEBRTC ЗВОНКИ ---
  socket.on('call-user', ({ targetUser, offer, isVideo }) => {
    const targetSocketEntry = Array.from(users.entries()).find(([_, u]) => u.username === targetUser);
    if (targetSocketEntry) {
      io.to(targetSocketEntry[0]).emit('incoming-call', {
        from: socket.username,
        fromSocketId: socket.id,
        offer,
        isVideo
      });
    }
  });

  socket.on('make-answer', ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit('call-answered', {
      fromSocketId: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', ({ targetSocketId, candidate }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', { candidate });
    }
  });

  socket.on('end-call', ({ targetSocketId }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-ended');
    }
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    broadcastUsers();
  });

  function broadcastUsers() {
    const userList = Array.from(new Set(Array.from(users.values()).map(u => u.username)))
      .map(username => {
        const isOnline = Array.from(users.values()).some(u => u.username === username && u.online);
        return { username, online: isOnline };
      });
    io.emit('users list', userList);
  }

  function sendUserGroups(userSocket) {
    if (!userSocket.username) return;
    const userGroups = groups.filter(g => g.members.includes(userSocket.username));
    userSocket.emit('user rooms', userGroups);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
