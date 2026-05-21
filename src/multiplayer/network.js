// src/multiplayer/network.js
// Real-time multiplayer using Socket.IO. One computer hosts a small server
// and becomes the "master clock"; other computers connect as clients and
// follow the host's BPM, similar to Ableton Link.
//
// The host process embeds a socket.io server on a local port (default 3030).
// Clients connect using the host's LAN IP, e.g. 192.168.1.10.

window.Network = (() => {

  const PORT = 3030;
  let role = 'offline';   // 'offline' | 'host' | 'client'
  let server = null;       // socket.io server (host only)
  let socket = null;       // socket.io client connection (client only)
  const httpModule = require('http');
  const statusEl = () => document.getElementById('network-status');

  /**
   * Become the host. Starts a tiny HTTP server with socket.io attached and
   * broadcasts events (e.g. BPM changes) to every connected client.
   */
  function host() {
    try {
      const { Server } = require('socket.io');
      const http = httpModule.createServer();
      server = new Server(http, { cors: { origin: '*' } });

      server.on('connection', (client) => {
        console.log('[Network] Client connected:', client.id);
        // When a client joins mid-session, immediately share the current BPM.
        const bpm = Number(document.getElementById('master-bpm').value);
        client.emit('bpm', bpm);
      });

      http.listen(PORT, () => {
        role = 'host';
        statusEl().textContent = `Hosting on port ${PORT}`;
        console.log('[Network] Hosting on port', PORT);
      });
    } catch (err) {
      console.error('[Network] Failed to host:', err);
      statusEl().textContent = 'Host failed — see console';
    }
  }

  /**
   * Join an existing host. The address is the host's LAN IP.
   */
  function join(address) {
    if (!address) {
      statusEl().textContent = 'Enter a host address first.';
      return;
    }
    try {
      const { io } = require('socket.io-client');
      socket = io(`http://${address}:${PORT}`);

      socket.on('connect', () => {
        role = 'client';
        statusEl().textContent = `Connected to ${address}`;
        console.log('[Network] Connected to host', address);
      });

      // The host is the source of truth for tempo — follow it.
      socket.on('bpm', (bpm) => {
        document.getElementById('master-bpm').value = bpm;
        document.getElementById('master-bpm-value').textContent = bpm;
        window.Audio.setBpm(bpm);
      });

      socket.on('disconnect', () => {
        statusEl().textContent = 'Disconnected';
      });
    } catch (err) {
      console.error('[Network] Failed to join:', err);
      statusEl().textContent = 'Join failed — see console';
    }
  }

  /**
   * Push a new BPM value out to everyone. Only the host actually broadcasts;
   * clients ignore this call because the host is the authority.
   */
  function broadcastBpm(bpm) {
    if (role === 'host' && server) {
      server.emit('bpm', bpm);
    }
  }

  return { host, join, broadcastBpm };
})();
