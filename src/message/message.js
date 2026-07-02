const params = new URLSearchParams(location.search);
const toId = params.get('id') || '';

const entry = document.getElementById('entry');
const sendBtn = document.getElementById('send');
document.getElementById('who').textContent = params.get('label') || 'Friend';

function send() {
  const text = entry.value.trim();
  if (!text) {
    entry.focus();
    return;
  }
  window.api.send('msg:send', { toId, text });
  window.close();
}

sendBtn.addEventListener('click', send);
entry.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

window.addEventListener('DOMContentLoaded', () => entry.focus());
setTimeout(() => entry.focus(), 50);
