const selfCodeEl = document.getElementById('selfcode');
const friendsEl = document.getElementById('friends');
const requestsEl = document.getElementById('requests');
const friendCodeEl = document.getElementById('friendcode');
const displayNameEl = document.getElementById('displayname');
const statusEl = document.getElementById('netstatus');
const roomJoinRow = document.getElementById('roomjoinrow');
const roomCurrentRow = document.getElementById('roomcurrentrow');
const roomNameEl = document.getElementById('roomname');
const roomLabelEl = document.getElementById('roomlabel');
const roomMembersEl = document.getElementById('roommembers');

// Kept so the room list can show who's already a friend (and re-render when
// friendships change).
let lastFriends = [];
let lastRoom = { room: '', members: [] };

function makeRow(f) {
  const row = document.createElement('div');
  row.className = 'friend';
  row.dataset.id = f.id;

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = f.label || 'Friend';

  const id = document.createElement('span');
  id.className = 'id';
  id.textContent = f.id;
  id.title = f.id;

  row.append(name, id);
  return row;
}

// People in the current room, drawn like friend rows. Everyone here is online
// by definition (presence). Strangers get an "Add friend" button.
function renderRoom() {
  const inRoom = !!lastRoom.room;
  roomJoinRow.hidden = inRoom;
  roomCurrentRow.hidden = !inRoom;
  roomLabelEl.textContent = inRoom ? `In room: ${lastRoom.room}` : '';

  roomMembersEl.innerHTML = '';
  if (!inRoom) return;
  const members = lastRoom.members || [];
  if (!members.length) {
    const empty = document.createElement('div');
    empty.className = 'roomempty';
    empty.textContent = 'Nobody else here yet.';
    roomMembersEl.appendChild(empty);
    return;
  }
  for (const m of members) {
    const row = makeRow({ id: m.id, label: m.name });
    const dot = document.createElement('span');
    dot.className = 'dot online';
    row.prepend(dot);

    const f = lastFriends.find((x) => x.id === m.id);
    if (f && f.status === 'accepted') {
      const tag = document.createElement('span');
      tag.className = 'pendtag';
      tag.textContent = 'friend';
      row.append(tag);
    } else if (f) {
      const tag = document.createElement('span');
      tag.className = 'pendtag';
      tag.textContent = f.status === 'pending' ? 'pending' : 'invited you';
      row.append(tag);
    } else {
      const add = document.createElement('button');
      add.className = 'accept';
      add.textContent = 'Add friend';
      add.addEventListener('click', async () => {
        const res = await window.api.invoke('friends:add', { code: m.id, label: m.name });
        if (!(res && res.ok)) statusEl.textContent = (res && res.error) || 'Could not send';
      });
      row.append(add);
    }
    roomMembersEl.appendChild(row);
  }
}

function renderAll(friends) {
  lastFriends = friends;
  renderRoom(); // friendship changes flip the room rows' buttons/tags
  const incoming = friends.filter((f) => f.status === 'incoming');
  const others = friends.filter((f) => f.status !== 'incoming');

  requestsEl.innerHTML = '';
  for (const f of incoming) {
    const row = makeRow(f);
    const accept = document.createElement('button');
    accept.className = 'accept';
    accept.textContent = 'Accept';
    accept.addEventListener('click', () => window.api.invoke('friends:accept', { id: f.id }));
    const decline = document.createElement('button');
    decline.className = 'rm';
    decline.textContent = 'Decline';
    decline.addEventListener('click', () => window.api.invoke('friends:decline', { id: f.id }));
    row.append(accept, decline);
    requestsEl.appendChild(row);
  }

  friendsEl.innerHTML = '';
  for (const f of others) {
    const row = makeRow(f);
    if (f.status === 'accepted') {
      const dot = document.createElement('span');
      dot.className = 'dot' + (f.online ? ' online' : '');
      row.prepend(dot);
    } else if (f.status === 'pending') {
      const tag = document.createElement('span');
      tag.className = 'pendtag';
      tag.textContent = 'pending';
      row.append(tag);
    }
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = f.status === 'pending' ? 'Cancel' : 'Remove';
    rm.addEventListener('click', () => window.api.invoke('friends:remove', { id: f.id }));
    row.append(rm);
    friendsEl.appendChild(row);
  }
}

async function load() {
  const { selfId, friends } = await window.api.invoke('friends:list');
  selfCodeEl.textContent = selfId || '(generating...)';
  selfCodeEl.title = selfId || '';
  lastRoom = (await window.api.invoke('room:status')) || lastRoom;
  renderAll(friends || []);

  const cfg = await window.api.invoke('settings:get');
  displayNameEl.value = cfg.displayName || '';

  const s = await window.api.invoke('net:status');
  if (s && s.configured) {
    statusEl.textContent = 'Connected. Invites and messages will be delivered.';
    statusEl.className = 'netstatus on';
  } else {
    statusEl.textContent = 'Offline: set up Supabase in Settings before adding friends.';
    statusEl.className = 'netstatus off';
  }
}

document.getElementById('copycode').addEventListener('click', async () => {
  const code = selfCodeEl.textContent.trim();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch {}
});

document.getElementById('addfriend').addEventListener('click', async () => {
  const code = friendCodeEl.value.trim();
  if (!code) {
    friendCodeEl.focus();
    return;
  }
  const res = await window.api.invoke('friends:add', { code });
  if (res && res.ok) friendCodeEl.value = '';
  else statusEl.textContent = (res && res.error) || 'Could not send';
});

displayNameEl.addEventListener('change', async () => {
  await window.api.invoke('settings:set', { displayName: displayNameEl.value.trim() });
});

document.getElementById('joinroom').addEventListener('click', async () => {
  const name = roomNameEl.value.trim();
  if (!name) {
    roomNameEl.focus();
    return;
  }
  const res = await window.api.invoke('room:join', { name });
  if (!(res && res.ok)) statusEl.textContent = (res && res.error) || 'Could not join';
});
roomNameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('joinroom').click();
});

document.getElementById('leaveroom').addEventListener('click', () => {
  window.api.invoke('room:leave');
});

window.api.on('room:changed', (payload) => {
  lastRoom = payload || { room: '', members: [] };
  renderRoom();
});

window.api.on('friends:changed', ({ friends }) => renderAll(friends || []));
window.api.on('friends:presence', ({ id, online }) => {
  const dot = friendsEl.querySelector(`.friend[data-id="${CSS.escape(id)}"] .dot`);
  if (dot) dot.classList.toggle('online', !!online);
});

document.getElementById('close').addEventListener('click', () => window.close());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});

load();
