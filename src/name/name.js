const entry = document.getElementById('entry');
const saveBtn = document.getElementById('save');

function save() {
  const name = entry.value.trim();
  if (!name) {
    entry.focus();
    return;
  }
  window.api.send('name:save', name);
  window.close();
}

saveBtn.addEventListener('click', save);
entry.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    save();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

window.addEventListener('DOMContentLoaded', () => entry.focus());
setTimeout(() => entry.focus(), 50);
