// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

const PORT = process.env.PORT || 3000;

// Simple in-memory users: socketId -> {name}
const users = new Map();

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join', (name) => {
    users.set(socket.id, { name });
    socket.broadcast.emit('user:join', { id: socket.id, name });
    io.emit('users', Array.from(users.values()));
  });

  socket.on('message', (msg) => {
    const user = users.get(socket.id) || { name: 'Anonymous' };
    const payload = {
      id: socket.id,
      name: user.name,
      text: msg.text,
      ts: Date.now(),
    };
    io.emit('message', payload);
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    users.delete(socket.id);
    if (user) socket.broadcast.emit('user:leave', { id: socket.id, name: user.name });
    io.emit('users', Array.from(users.values()));
    console.log('socket disconnected', socket.id);
  });
});

app.get('/', (req, res) => {
  res.send({ status: 'Echo server running' });
});

server.listen(PORT, () => {
  console.log(`Echo server listening on http://localhost:${PORT}`);
});
