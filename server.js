socket.on('toggle reaction', ({ roomId, messageId, emoji, user }) => {
  const roomMessages = messages[roomId] || [];
  const msg = roomMessages.find(m => m.id === messageId);

  if (msg) {
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

    const index = msg.reactions[emoji].indexOf(user);
    if (index > -1) {
      msg.reactions[emoji].splice(index, 1);
    } else {
      msg.reactions[emoji].push(user);
    }

    io.to(roomId).emit('update reaction', {
      roomId,
      messageId,
      reactions: msg.reactions
    });
  }
});
