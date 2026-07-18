// The lily pad left behind by a hidden pond. Mirrors the pet window's manual
// drag (the window is created non-movable) so we can tell a drag from a click:
// small movement = a click, which reopens the pond.

let down = null;

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = {
    screenX: e.screenX,
    screenY: e.screenY,
    winX: window.screenX,
    winY: window.screenY,
    moved: false
  };
});

window.addEventListener('mousemove', (e) => {
  if (!down) return;
  const dx = e.screenX - down.screenX;
  const dy = e.screenY - down.screenY;
  if (!down.moved && Math.hypot(dx, dy) > 4) down.moved = true;
  if (down.moved) window.api.send('lily:move', { x: down.winX + dx, y: down.winY + dy });
});

window.addEventListener('mouseup', () => {
  if (!down) return;
  const wasDrag = down.moved;
  down = null;
  if (wasDrag) window.api.send('lily:move-end');
  else window.api.send('lily:click');
});
