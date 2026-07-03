// End-of-countdown message dialog. main opens this window with the message and
// the app color passed as query params; we render them and close on any
// dismissal (button, Enter, Escape).
const params = new URLSearchParams(location.search);
const message = params.get('message') || "Time\u2019s up!";
const color = params.get('color') || '#8b5cf6';

document.getElementById('card').style.setProperty('--accent', color);
document.getElementById('message').textContent = message;

function dismiss() {
  window.close();
}

document.getElementById('dismiss').addEventListener('click', dismiss);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Enter') {
    e.preventDefault();
    dismiss();
  }
});

const btn = document.getElementById('dismiss');
window.addEventListener('DOMContentLoaded', () => btn.focus());
setTimeout(() => btn.focus(), 50);
