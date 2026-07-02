const entry = document.getElementById('entry');
const sendBtn = document.getElementById('send');

// Force everything typed into the shout box to capital letters.
entry.addEventListener('input', () => {
  const start = entry.selectionStart;
  const end = entry.selectionEnd;
  const upper = entry.value.toUpperCase();
  if (upper !== entry.value) {
    entry.value = upper;
    entry.setSelectionRange(start, end);
  }
});

function send() {
  const text = entry.value.trim().toUpperCase();
  if (!text) {
    entry.focus();
    return;
  }
  window.api.send('shout:send', { text });
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
