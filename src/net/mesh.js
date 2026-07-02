// WebRTC mesh manager (runs in a hidden renderer, since RTCPeerConnection only
// exists in a renderer, not the Electron main process).
//
// Main drives this over IPC:
//   in  mesh:config        { iceServers }
//   in  mesh:peer-present  { friendId, online, initiator }
//   in  mesh:signal-in     { friendId, kind, data }   (offer/answer/ice)
//   in  mesh:broadcast     msg                          (send to all peers)
//   in  mesh:send          { friendId, msg }            (send to one peer)
//   out mesh:signal-out    { friendId, kind, data }
//   out mesh:peer-connected/disconnected { friendId }
//   out mesh:peer-data     { friendId, msg }
//
// All application data (frog beats + chat) rides the data channels below and
// is DTLS-encrypted end-to-end; it never returns to the signaling server.

const api = window.api;

let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
const peers = new Map(); // friendId -> { pc, dc }

api.on('mesh:config', (cfg) => {
  if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length) {
    iceServers = cfg.iceServers;
  }
});

function wireChannel(friendId, dc, entry) {
  entry.dc = dc;
  dc.onopen = () => api.send('mesh:peer-connected', { friendId });
  dc.onclose = () => api.send('mesh:peer-disconnected', { friendId });
  dc.onmessage = (e) => {
    let msg = null;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    api.send('mesh:peer-data', { friendId, msg });
  };
}

function makePeer(friendId, initiator) {
  if (peers.has(friendId)) return peers.get(friendId);
  const pc = new RTCPeerConnection({ iceServers });
  const entry = { pc, dc: null };
  peers.set(friendId, entry);

  pc.onicecandidate = (e) => {
    if (e.candidate) api.send('mesh:signal-out', { friendId, kind: 'ice', data: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'failed' || s === 'closed') dropPeer(friendId);
  };

  if (initiator) {
    const dc = pc.createDataChannel('frog', { ordered: true });
    wireChannel(friendId, dc, entry);
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => api.send('mesh:signal-out', { friendId, kind: 'offer', data: pc.localDescription }))
      .catch((err) => console.warn('offer failed', err));
  } else {
    pc.ondatachannel = (e) => wireChannel(friendId, e.channel, entry);
  }
  return entry;
}

function dropPeer(friendId) {
  const entry = peers.get(friendId);
  if (!entry) return;
  try {
    if (entry.dc) entry.dc.close();
    entry.pc.close();
  } catch {}
  peers.delete(friendId);
  api.send('mesh:peer-disconnected', { friendId });
}

// A friend came online (or went offline). The peer with the smaller id makes
// the offer; the other waits for it (avoids offer glare).
api.on('mesh:peer-present', ({ friendId, online, initiator }) => {
  if (online) makePeer(friendId, !!initiator);
  else dropPeer(friendId);
});

api.on('mesh:signal-in', async ({ friendId, kind, data }) => {
  let entry = peers.get(friendId);
  if (!entry) entry = makePeer(friendId, false);
  const pc = entry.pc;
  try {
    if (kind === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      api.send('mesh:signal-out', { friendId, kind: 'answer', data: pc.localDescription });
    } else if (kind === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
    } else if (kind === 'ice') {
      await pc.addIceCandidate(new RTCIceCandidate(data));
    }
  } catch (err) {
    console.warn('signal-in handling failed', kind, err);
  }
});

function sendTo(entry, msg) {
  if (entry && entry.dc && entry.dc.readyState === 'open') {
    try {
      entry.dc.send(JSON.stringify(msg));
    } catch {}
  }
}

// Stream a local beat to every connected peer.
api.on('mesh:broadcast', (msg) => {
  for (const entry of peers.values()) sendTo(entry, msg);
});

// Send a message (e.g. chat) to a single peer.
api.on('mesh:send', ({ friendId, msg }) => {
  sendTo(peers.get(friendId), msg);
});
