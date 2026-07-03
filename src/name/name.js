const entry = document.getElementById('entry');
const saveBtn = document.getElementById('save');
const closeBtn = document.getElementById('close');
const colorsEl = document.getElementById('colors');

// Mirrors the palette used in Settings so the first-run picker matches later
// choices. The live frog perched on the card previews the selection instantly.
const COLORS = ['green', 'orange', 'pink', 'brown', 'rnbw', 'blue'];
const SWATCH = {
  green: '#5fb85f',
  orange: '#e8973c',
  pink: '#e87fb0',
  brown: '#9c6b43',
  rnbw: 'linear-gradient(135deg,#e85a5a,#e8c85a,#5fb85f,#5a8fe8)',
  blue: '#5a8fe8'
};

const params = new URLSearchParams(location.search);
let color = COLORS.includes(params.get('color')) ? params.get('color') : 'green';

function renderColors() {
  colorsEl.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (color === c ? ' sel' : '');
    b.style.background = SWATCH[c];
    b.title = c;
    b.addEventListener('click', () => {
      color = c;
      renderColors();
      // Preview live on the frog sitting above this card.
      window.api.send('name:color', c);
    });
    colorsEl.appendChild(b);
  }
}

function save() {
  const name = entry.value.trim();
  if (!name) {
    entry.focus();
    return;
  }
  window.api.send('name:save', { name, color });
  window.close();
}

// Quit the whole app (this window + the locked frog perched on it) instead of
// just dismissing the card and leaving a nameless frog behind.
function quit() {
  window.api.send('app:quit');
}

renderColors();

saveBtn.addEventListener('click', save);
closeBtn.addEventListener('click', quit);
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
