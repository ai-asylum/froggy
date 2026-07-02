const entry = document.getElementById('entry');
const saveBtn = document.getElementById('save');
const skipBtn = document.getElementById('skip');
const title = document.getElementById('title');

async function save() {
  const text = entry.value.trim();
  if (!text) {
    entry.focus();
    return;
  }
  saveBtn.disabled = true;
  const res = await window.api.invoke('note:save', text);
  if (!res || !res.ok) {
    saveBtn.disabled = false;
    title.textContent = 'Could not save: ' + ((res && res.error) || 'unknown error');
    return;
  }
  // Main closes this window on success.
}

saveBtn.addEventListener('click', save);
skipBtn.addEventListener('click', () => window.api.send('attention:skip'));

entry.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    save();
  } else if (e.key === 'Escape') {
    window.api.send('input:close');
  }
});

window.api.on('input:init', (state) => {
  if (state && state.attention) {
    title.textContent = "It's time! What have you been up to this past hour?";
    title.classList.add('attention');
  }
});

window.addEventListener('DOMContentLoaded', () => entry.focus());
setTimeout(() => entry.focus(), 50);
