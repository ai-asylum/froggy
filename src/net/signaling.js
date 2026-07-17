// Supabase signaling — the *only* thing that touches Supabase.
//
// Two kinds of channels, both carrying nothing but control/handshake data
// (never frog state or chat, which go P2P):
//
//   inbox:<myCode>      I'm always subscribed here. Anyone can drop a friend
//                       request / accept / removal addressed to me.
//   pair:<a>:<b>        One per *accepted* friendship (ids sorted). Carries
//                       presence (online/offline) + the WebRTC handshake.
//
// Once two accepted frogs connect, all real data flows P2P over the data
// channel and never comes back through here.

let createClient = null;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (err) {
  console.warn('supabase-js not available, multiplayer disabled:', err.message);
}

// Electron's main process runs on Node, which only ships a global WebSocket on
// Node 22+. Supply the `ws` implementation so Realtime works on older Node too.
let WebSocketImpl = null;
try {
  WebSocketImpl = require('ws');
} catch (err) {
  console.warn('ws not available; realtime may fail on Node < 22:', err.message);
}

let client = null;
let selfId = null;
let inbox = null;
let cbs = {};
const pairs = new Map(); // friendId -> { channel, online }

function pairName(a, b) {
  return 'pair:' + [a, b].sort().join(':');
}

function isConfigured(cfg) {
  return !!(createClient && cfg && cfg.supabase && cfg.supabase.url && cfg.supabase.anonKey && cfg.selfId);
}

// Start signaling. `handlers` = {
//   onPresence(friendId, online), onSignal(friendId, kind, data),
//   onFriendRequest(fromId, fromName), onFriendAccept(fromId, fromName),
//   onFriendRemove(fromId)
// }. `acceptedIds` are friends already accepted (rejoin their pair channels).
function start(cfg, handlers, acceptedIds) {
  if (!isConfigured(cfg)) return false;
  selfId = cfg.selfId;
  cbs = handlers || {};
  client = createClient(cfg.supabase.url, cfg.supabase.anonKey, {
    realtime: {
      params: { eventsPerSecond: 40 },
      ...(WebSocketImpl ? { transport: WebSocketImpl } : {})
    }
  });

  // My personal inbox for friendship control messages.
  inbox = client.channel('inbox:' + selfId, { config: { broadcast: { self: false } } });
  inbox.on('broadcast', { event: 'friend' }, ({ payload }) => {
    if (!payload || payload.from === selfId) return;
    if (payload.kind === 'request') cbs.onFriendRequest && cbs.onFriendRequest(payload.from, payload.name);
    else if (payload.kind === 'accept') cbs.onFriendAccept && cbs.onFriendAccept(payload.from, payload.name);
    else if (payload.kind === 'remove') cbs.onFriendRemove && cbs.onFriendRemove(payload.from);
  });
  inbox.subscribe();

  for (const id of acceptedIds || []) addPair(id);
  return true;
}

function stop() {
  for (const id of [...pairs.keys()]) removePair(id);
  if (client) {
    try {
      client.removeAllChannels();
    } catch {}
  }
  client = null;
  inbox = null;
  room = null;
}

// Fire-and-forget a control message into someone else's inbox. We briefly join
// their inbox channel, send, then leave.
function sendToInbox(targetId, payload) {
  if (!client || !targetId) return;
  const ch = client.channel('inbox:' + targetId, { config: { broadcast: { self: false } } });
  ch.subscribe(async (status) => {
    if (status !== 'SUBSCRIBED') return;
    try {
      await ch.send({ type: 'broadcast', event: 'friend', payload: { from: selfId, ...payload } });
    } catch {}
    setTimeout(() => {
      try {
        client.removeChannel(ch);
      } catch {}
    }, 1500);
  });
}

function sendRequest(targetId, name) {
  sendToInbox(targetId, { kind: 'request', name });
}
function sendAccept(targetId, name) {
  sendToInbox(targetId, { kind: 'accept', name });
}
function sendRemove(targetId) {
  sendToInbox(targetId, { kind: 'remove' });
}

// Join the presence + signaling channel for an accepted friend.
function addPair(friendId) {
  if (!client || !friendId || friendId === selfId || pairs.has(friendId)) return;
  const channel = client.channel(pairName(selfId, friendId), {
    config: { presence: { key: selfId }, broadcast: { self: false } }
  });
  const entry = { channel, online: false };
  pairs.set(friendId, entry);

  const recompute = () => {
    const state = channel.presenceState();
    const online = Object.keys(state).includes(friendId);
    if (online !== entry.online) {
      entry.online = online;
      cbs.onPresence && cbs.onPresence(friendId, online);
    }
  };

  channel.on('presence', { event: 'sync' }, recompute);
  channel.on('presence', { event: 'join' }, recompute);
  channel.on('presence', { event: 'leave' }, recompute);
  channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
    if (payload && payload.from === friendId) {
      cbs.onSignal && cbs.onSignal(friendId, payload.kind, payload.data);
    }
  });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      try {
        await channel.track({ id: selfId, at: Date.now() });
      } catch {}
      recompute();
    }
  });
}

function removePair(friendId) {
  const entry = pairs.get(friendId);
  if (!entry) return;
  try {
    if (client) client.removeChannel(entry.channel);
  } catch {}
  pairs.delete(friendId);
}

// --- Rooms -------------------------------------------------------------------
// A room is a shared presence channel (`room:<name>`) anyone can join by name —
// no password, nothing stored server-side. Everyone in it tracks a tiny profile
// { id, name, color }; joins and leaves arrive live via presence sync.
let room = null; // { channel, name, meta }

function roomMemberList() {
  if (!room) return [];
  const state = room.channel.presenceState();
  const out = [];
  for (const metas of Object.values(state)) {
    const m = metas && metas[0];
    if (m && m.id) out.push({ id: m.id, name: m.name || '', color: m.color || '' });
  }
  return out;
}

// Join (or switch to) a room. `onSync` fires with the full member list every
// time anyone joins or leaves. Only one room at a time — joining leaves the
// previous one.
function joinRoom(name, meta, onSync, onAction) {
  if (!client || !name) return false;
  leaveRoom();
  const channel = client.channel('room:' + name, {
    config: { presence: { key: selfId }, broadcast: { self: false } }
  });
  room = { channel, name, meta: { id: selfId, ...meta } };
  const sync = () => onSync && onSync(roomMemberList());
  channel.on('presence', { event: 'sync' }, sync);
  channel.on('presence', { event: 'join' }, sync);
  channel.on('presence', { event: 'leave' }, sync);
  // Shouts and frog "bounce" beats from roommates. Friends exchange these P2P;
  // room members share only this channel, so the same lightweight events ride
  // it here. It never carries private DMs.
  channel.on('broadcast', { event: 'action' }, ({ payload }) => {
    if (!payload || payload.from === selfId) return;
    onAction && onAction(payload.from, payload.msg);
  });
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      try {
        await channel.track(room.meta);
      } catch {}
      sync();
    }
  });
  return true;
}

function leaveRoom() {
  if (!room) return;
  try {
    if (client) client.removeChannel(room.channel);
  } catch {}
  room = null;
}

// Fan a lightweight event (a shout or a frog "bounce" beat) out to everyone in
// the current room over its Supabase channel. Frog state normally stays P2P,
// but roommates have no P2P link, so these opt-in events ride the room channel.
// No-ops when we're not in a room.
function broadcastRoom(msg) {
  if (!room || !msg) return;
  try {
    room.channel.send({ type: 'broadcast', event: 'action', payload: { from: selfId, msg } });
  } catch {}
}

// Re-announce the local profile (name/color change) to the current room.
async function updateRoomProfile(patch) {
  if (!room) return;
  room.meta = { ...room.meta, ...patch };
  try {
    await room.channel.track(room.meta);
  } catch {}
}

// --- Skins (persisted profiles) --------------------------------------------
// Unlike presence (which vanishes when you go offline), a frog's chosen skin is
// stored in a small Supabase table so friends see the right color even before
// you next come online. Requires a `froggy_profiles` table — see README. Both
// calls fail quietly if the table/permissions aren't set up.
const PROFILE_TABLE = 'froggy_profiles';

async function publishProfile(color) {
  if (!client || !selfId || !color) return;
  try {
    const { error } = await client
      .from(PROFILE_TABLE)
      .upsert({ id: selfId, color, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (err) {
    console.warn('Could not publish skin to Supabase:', err.message);
  }
}

// Look up the stored skin color for a set of friend ids -> { id: color }.
async function fetchProfiles(ids) {
  const out = {};
  if (!client || !Array.isArray(ids) || !ids.length) return out;
  try {
    const { data, error } = await client
      .from(PROFILE_TABLE)
      .select('id,color')
      .in('id', ids);
    if (error) throw error;
    for (const row of data || []) {
      if (row && row.id && row.color) out[row.id] = row.color;
    }
  } catch (err) {
    console.warn('Could not fetch friend skins from Supabase:', err.message);
  }
  return out;
}

// Send a WebRTC handshake message (offer/answer/ice) to an accepted friend.
function sendSignal(friendId, kind, data) {
  const entry = pairs.get(friendId);
  if (!entry) return;
  entry.channel.send({
    type: 'broadcast',
    event: 'signal',
    payload: { from: selfId, kind, data }
  });
}

module.exports = {
  start,
  stop,
  addPair,
  removePair,
  sendRequest,
  sendAccept,
  sendRemove,
  sendSignal,
  joinRoom,
  leaveRoom,
  broadcastRoom,
  updateRoomProfile,
  publishProfile,
  fetchProfiles,
  isConfigured
};
