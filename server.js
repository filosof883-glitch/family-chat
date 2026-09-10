// Автоматическое переподключение при обрыве соединения
const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000
});

const username = prompt("Введите ваше имя:") || "Гость";

// Регистрируемся на сервере при входе
socket.emit('user_joined', username);

// При повторном подключении (например, после "пробуждения" Render) заново регистрируемся
socket.on('connect', () => {
  socket.emit('user_joined', username);
});

// Слушаем обновление списка онлайн
socket.on('update_user_list', (users) => {
  const userListElement = document.getElementById('online-users');
  if (userListElement) {
    userListElement.innerHTML = users.map(user => `<li>🟢 ${user}</li>`).join('');
  }
});

// Приём сообщений
socket.on('receive_message', (data) => {
  const chatBox = document.getElementById('chat-box');
  if (chatBox) {
    const msgDiv = document.createElement('div');
    msgDiv.textContent = `[${data.time}] ${data.user}: ${data.text}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
});

// Функция отправки
function sendMessage() {
  const input = document.getElementById('message-input');
  if (input && input.value.trim() !== '') {
    socket.emit('send_message', { text: input.value });
    input.value = '';
  }
}
