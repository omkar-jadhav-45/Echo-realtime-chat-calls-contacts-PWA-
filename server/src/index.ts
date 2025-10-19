// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'
import { Redis } from 'ioredis'
import { connectToMongo, Message, isMongoConnected, Contact } from './db.js'
import crypto from 'crypto'

dotenv.config()

const REDIS_URL = process.env.REDIS_URL || ''
let redis: Redis | null = null
if (REDIS_URL) {
  redis = new Redis(REDIS_URL)
  redis?.on('connect', () => console.log('Connected to Redis'))
  redis?.on('error', (e) => console.error('Redis error', e))
}

const app = express()
app.use(cors())
app.use(express.json())

const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

const BASE_PORT = process.env.PORT ? Number(process.env.PORT) : 3000
const AUTH_URL = process.env.AUTH_URL || 'http://localhost:8080'

type User = { id: string; name: string; userId?: string }

const users = new Map<string, User>()
const userRooms = new Map<string, string | null>() // socketId -> room name (null = global)
const inMemMessages: Array<{ name: string; text: string; ts: number; room: string | null }> = []
// fallback contacts store: ownerId -> set of composite keys "name|contactId"
const inMemContacts = new Map<string, Set<string>>()
const rateMap = new Map<string, { count: number; ts: number }>()
const onlineUserIds = new Set<string>()

function rateLimit(key: string, limit = 60, windowMs = 60_000) {
  const now = Date.now()
  const cur = rateMap.get(key)
  if (!cur || now - cur.ts > windowMs) { rateMap.set(key, { count: 1, ts: now }); return true }
  if (cur.count >= limit) return false
  cur.count++
  return true
}

// ensure DB connection happens early
connectToMongo().catch(() => {})

// --- Auth helpers ---
type JwtClaims = { sub: string; exp: number }
async function verifyJwt(bearer?: string): Promise<JwtClaims | null> {
  try {
    if (!bearer) return null
    const [scheme, token] = bearer.split(' ')
    if ((scheme || '').toLowerCase() !== 'bearer' || !token) return null
    const resp = await fetch(`${AUTH_URL}/token/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    })
    if (!resp.ok) return null
    return await resp.json() as JwtClaims
  } catch { return null }
}

function requireAuth() {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const claims = await verifyJwt(req.headers.authorization)
    if (!claims) return res.status(401).json({ ok: false, error: 'unauthorized' })
    ;(req as any).user = claims
    next()
  }
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id)

  socket.on('join', (payload: any) => {
    let name: string
    let userId: string | undefined
    if (typeof payload === 'string') { name = payload } else { name = (payload?.name || 'Anonymous'); userId = typeof payload?.userId === 'string' ? payload.userId : undefined }
    users.set(socket.id, { id: socket.id, name, userId })
    userRooms.set(socket.id, null)
    socket.broadcast.emit('user:join', { id: socket.id, name })
    io.emit('users', Array.from(users.values()))
    // mark presence in global set
    if (redis) {
      const key = 'presence:global'
      redis.sadd(key, socket.id)
      if (userId) redis.sadd('presence:users', userId)
    }
    if (userId) onlineUserIds.add(userId)
  })

  // join a named room (string). Room name 'global' or null means broadcast to all
  socket.on('joinRoom', (room: string | null) => {
    const prev = userRooms.get(socket.id) || null
    if (prev) socket.leave(prev)
    if (room) {
      socket.join(room)
      userRooms.set(socket.id, room)
      const user = users.get(socket.id)
      io.to(room).emit('room:join', { id: socket.id, name: user?.name, room })
      // emit current users in room
      const sockets = Array.from(io.sockets.adapter.rooms.get(room) || [])
      const usersInRoom = sockets.map((id) => users.get(id)).filter(Boolean)
      io.to(room).emit('usersInRoom', usersInRoom)
      if (redis) {
        redis.sadd(`presence:${room}`, socket.id)
      }
    } else {
      userRooms.set(socket.id, null)
    }
  })

  socket.on('leaveRoom', () => {
    const prev = userRooms.get(socket.id) || null
    if (prev) {
      socket.leave(prev)
      userRooms.set(socket.id, null)
      const user = users.get(socket.id)
      io.to(prev).emit('room:leave', { id: socket.id, name: user?.name, room: prev })
      const sockets = Array.from(io.sockets.adapter.rooms.get(prev) || [])
      const usersInRoom = sockets.map((id) => users.get(id)).filter(Boolean)
      io.to(prev).emit('usersInRoom', usersInRoom)
      if (redis) {
        redis.srem(`presence:${prev}`, socket.id)
      }
    }
  })

  socket.on('message', async (msg: { text: string; room?: string | null }) => {
    const user = users.get(socket.id) || { id: socket.id, name: 'Anonymous' }
    const payload: any = { id: socket.id, name: user.name, text: msg.text, ts: Date.now(), room: msg.room ?? userRooms.get(socket.id) ?? null }
    const room = payload.room
    // persist message if DB is available
    try {
      if (isMongoConnected()) {
        await Message.create({ name: payload.name, text: payload.text, ts: payload.ts, room: payload.room })
      } else {
        inMemMessages.push({ name: payload.name, text: payload.text, ts: payload.ts, room: payload.room ?? null })
        // cap to last 500
        if (inMemMessages.length > 500) inMemMessages.splice(0, inMemMessages.length - 500)
      }
    } catch (e) {
      console.error('Failed to save message', e)
    }

    if (room) io.to(room).emit('message', payload)
    else io.emit('message', payload)
  })

  socket.on('disconnect', () => {
    const user = users.get(socket.id)
    users.delete(socket.id)
    if (user) socket.broadcast.emit('user:leave', { id: socket.id, name: user.name })
    io.emit('users', Array.from(users.values()))
    if (redis) {
      // remove from all presence sets
      // best-effort: remove from global and any room known
      redis.srem('presence:global', socket.id)
      const room = userRooms.get(socket.id)
      if (room) redis.srem(`presence:${room}`, socket.id)
      // also remove typing flags
      redis.srem('typing:global', socket.id)
      if (room) redis.srem(`typing:${room}`, socket.id)
      if (user?.userId) redis.srem('presence:users', user.userId)
    }
    if (user?.userId) onlineUserIds.delete(user.userId)
    console.log('socket disconnected', socket.id)
  })

  // --- WebRTC signaling relays ---
  socket.on('webrtc:offer', (payload: { to: string; sdp: RTCSessionDescriptionInit; media?: 'audio' | 'video'; callId?: string }) => {
    const to = payload?.to
    if (to) io.to(to).emit('webrtc:offer', { from: socket.id, sdp: payload.sdp, media: payload.media, callId: payload.callId })
  })
  socket.on('webrtc:answer', (payload: { to: string; sdp: RTCSessionDescriptionInit; callId?: string }) => {
    const to = payload?.to
    if (to) io.to(to).emit('webrtc:answer', { from: socket.id, sdp: payload.sdp, callId: payload.callId })
  })
  socket.on('webrtc:ice', (payload: { to: string; candidate: RTCIceCandidateInit; callId?: string }) => {
    const to = payload?.to
    if (to) io.to(to).emit('webrtc:ice', { from: socket.id, candidate: payload.candidate, callId: payload.callId })
  })
  socket.on('webrtc:end', (payload: { to: string }) => {
    const to = payload?.to
    if (to) io.to(to).emit('webrtc:end', { from: socket.id })
  })
  socket.on('call:busy', (payload: { to: string }) => {
    const to = payload?.to
    if (to) io.to(to).emit('call:busy', { from: socket.id })
  })
  socket.on('call:upgrade', (payload: { to: string; kind: 'video' | 'audio' }) => {
    const to = payload?.to
    if (to) io.to(to).emit('call:upgrade', { from: socket.id, kind: payload.kind })
  })
  socket.on('call:upgrade:response', (payload: { to: string; accepted: boolean; kind: 'video' | 'audio' }) => {
    const to = payload?.to
    if (to) io.to(to).emit('call:upgrade:response', { from: socket.id, accepted: payload.accepted, kind: payload.kind })
  })

  // --- Group call orchestration (mesh) ---
  // activeCalls keeps lightweight state of room calls (in-memory; optional persistence can be added)
  type CallType = 'audio' | 'video'
  type CallState = { room: string | null; type: CallType; participants: Set<string>; startedAt: number; initiator: string }
  // Store on io instance to keep across connections without module-level mutation duplication in hot reloads
  const anyIo = io as any
  if (!anyIo.__activeCalls) anyIo.__activeCalls = new Map<string, CallState>()
  if (!anyIo.__callLogs) anyIo.__callLogs = [] as Array<{ callId: string; room: string | null; type: CallType; startedAt: number; endedAt?: number; initiator: string; participants: string[] }>

  socket.on('call:invite', (payload: { callId: string; room: string | null; type: CallType; to?: string }) => {
    const { callId, room, type, to } = payload
    // create call record if not exists
    if (!anyIo.__activeCalls.has(callId)) {
      anyIo.__activeCalls.set(callId, { room, type, participants: new Set(), startedAt: Date.now(), initiator: socket.id })
      anyIo.__callLogs.push({ callId, room, type, startedAt: Date.now(), initiator: socket.id, participants: [] })
    }
    const user = users.get(socket.id)
    // direct invite
    if (to) {
      socket.to(to).emit('call:invite', { callId, type, from: socket.id, fromName: user?.name })
      return
    }
    // invite everyone in the specified room (or globally if room is null)
    if (room) {
      socket.to(room).emit('call:invite', { callId, type, from: socket.id, fromName: user?.name })
    } else {
      socket.broadcast.emit('call:invite', { callId, type, from: socket.id, fromName: user?.name })
    }
  })

  socket.on('call:join', (payload: { callId: string }) => {
    const st: CallState | undefined = anyIo.__activeCalls.get(payload.callId)
    if (!st) return
    st.participants.add(socket.id)
    // update log participants set
    const log = anyIo.__callLogs.find((l: any) => l.callId === payload.callId)
    if (log) {
      const set = new Set(log.participants)
      set.add(socket.id)
      log.participants = Array.from(set)
    }
    // Notify room about current participants (ids)
    const targetRoom = st.room
    const list = Array.from(st.participants.values())
    if (targetRoom) io.to(targetRoom).emit('call:participants', { callId: payload.callId, participants: list })
    else io.emit('call:participants', { callId: payload.callId, participants: list })
  })

  socket.on('call:leave', (payload: { callId: string }) => {
    const st: CallState | undefined = anyIo.__activeCalls.get(payload.callId)
    if (!st) return
    st.participants.delete(socket.id)
    const targetRoom = st.room
    const list = Array.from(st.participants.values())
    if (targetRoom) io.to(targetRoom).emit('call:participants', { callId: payload.callId, participants: list })
    else io.emit('call:participants', { callId: payload.callId, participants: list })
    // If none left, end the call
    if (st.participants.size === 0) {
      const log = anyIo.__callLogs.find((l: any) => l.callId === payload.callId)
      if (log && !log.endedAt) log.endedAt = Date.now()
      anyIo.__activeCalls.delete(payload.callId)
    }
  })

  socket.on('call:endAll', (payload: { callId: string }) => {
    const st: CallState | undefined = anyIo.__activeCalls.get(payload.callId)
    if (!st) return
    const targetRoom = st.room
    const participants = Array.from(st.participants.values())
    participants.forEach((pid: string) => io.to(pid).emit('webrtc:end', { from: socket.id }))
    if (targetRoom) io.to(targetRoom).emit('call:endAll', { callId: payload.callId })
    else io.emit('call:endAll', { callId: payload.callId })
    const log = anyIo.__callLogs.find((l: any) => l.callId === payload.callId)
    if (log && !log.endedAt) log.endedAt = Date.now()
    anyIo.__activeCalls.delete(payload.callId)
  })
})

app.get('/', (req, res) => res.send({ status: 'Echo server running' }))

// Simple login: returns JWT for provided or generated userId
// POST /auth/login { userId?, name? , expSeconds? }
app.post('/auth/login', async (req, res) => {
  try {
    const { userId, name, expSeconds } = req.body || {}
    const sub = typeof userId === 'string' && userId ? userId : crypto.randomUUID()
    // issue token via auth service
    const resp = await fetch(`${AUTH_URL}/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub, exp_seconds: typeof expSeconds === 'number' ? expSeconds : 3600 })
    })
    if (!resp.ok) {
      const text = await resp.text()
      return res.status(500).json({ ok: false, error: 'auth_issue_failed', detail: text })
    }
    const data = await resp.json() as { token: string }
    return res.json({ ok: true, token: data.token, userId: sub, name: typeof name === 'string' ? name : undefined })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: 'login_failed', detail: e?.message })
  }
})

// fetch recent messages (optional ?room=roomName)
app.get('/messages', async (req, res) => {
  const room = req.query.room as string | undefined
  if (isMongoConnected()) {
    const q: any = {}
    if (room) q.room = room
    const msgs = await Message.find(q).sort({ ts: 1 }).limit(200).lean().exec()
    res.json(msgs)
  } else {
    const filtered = inMemMessages
      .filter((m) => (room ? m.room === room : true))
      .sort((a, b) => a.ts - b.ts)
      .slice(-200)
    res.json(filtered)
  }
})

// Contacts API: owner scoping via query 'ownerId'; returns presence
// GET /contacts?ownerId=ID
app.get('/contacts', requireAuth(), async (req, res) => {
  const ownerId = (req.query.ownerId as string) || ''
  const claims = (req as any).user as JwtClaims
  // if ownerId omitted, use authenticated sub
  const effectiveOwner = ownerId || claims.sub
  // if provided, ensure it matches the authenticated user
  if (ownerId && ownerId !== claims.sub) return res.status(403).json({ ok: false, error: 'forbidden_owner_mismatch' })
  if (!effectiveOwner) return res.status(400).json({ ok: false, error: 'ownerId required' })
  if (!rateLimit(`get:${effectiveOwner}`)) return res.status(429).json({ ok: false, error: 'rate_limited' })
  if (isMongoConnected()) {
    const docs = await Contact.find({ ownerId: effectiveOwner }).sort({ name: 1 }).lean().exec()
    const contacts = docs.map((d:any) => ({ name: d.name || '', contactId: d.contactId || '' }))
    // presence by userId
    let onlineIds: string[] = []
    if (redis) onlineIds = await redis.smembers('presence:users')
    else onlineIds = Array.from(onlineUserIds)
    const withPresence = contacts.map((c:any) => ({ ...c, online: c.contactId ? onlineIds.includes(c.contactId) : false }))
    return res.json({ ok: true, contacts: withPresence })
  }
  const set = inMemContacts.get(effectiveOwner) || new Set<string>()
  const arr = Array.from(set).sort().map((key) => { const [name, contactId=''] = key.split('|'); return { name, contactId, online: contactId ? onlineUserIds.has(contactId) : false } })
  return res.json({ ok: true, contacts: arr })
})

// POST /contacts { ownerId, ownerName?, name, contactId? }
app.post('/contacts', requireAuth(), async (req, res) => {
  const claims = (req as any).user as JwtClaims
  const { ownerId, name, contactId } = req.body || {}
  const effectiveOwner = typeof ownerId === 'string' && ownerId ? ownerId : claims.sub
  if (ownerId && ownerId !== claims.sub) return res.status(403).json({ ok: false, error: 'forbidden_owner_mismatch' })
  if (!effectiveOwner || typeof effectiveOwner !== 'string') return res.status(400).json({ ok: false, error: 'ownerId required' })
  if ((name && typeof name !== 'string') || (name && name.length > 128)) return res.status(400).json({ ok: false, error: 'invalid name' })
  if (contactId && typeof contactId !== 'string') return res.status(400).json({ ok: false, error: 'invalid contactId' })
  if (!name && !contactId) return res.status(400).json({ ok: false, error: 'name or contactId required' })
  if (!rateLimit(`post:${effectiveOwner}`)) return res.status(429).json({ ok: false, error: 'rate_limited' })
  try {
    if (isMongoConnected()) {
      const filter: any = contactId ? { ownerId: effectiveOwner, contactId } : { ownerId: effectiveOwner, name }
      const update: any = { $setOnInsert: { ownerId: effectiveOwner }, $set: {} as any }
      if (name) update.$set.name = name
      if (contactId) update.$set.contactId = contactId
      await Contact.updateOne(filter, update, { upsert: true })
      return res.json({ ok: true })
    }
    const set = inMemContacts.get(effectiveOwner) || new Set<string>()
    const key = `${name || ''}|${contactId || ''}`
    set.add(key)
    inMemContacts.set(effectiveOwner, set)
    return res.json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'failed' })
  }
})

// DELETE /contacts?ownerId=ID&name=CONTACT
app.delete('/contacts', requireAuth(), async (req, res) => {
  const claims = (req as any).user as JwtClaims
  const ownerId = (req.query.ownerId as string) || ''
  const name = (req.query.name as string) || ''
  const contactId = (req.query.contactId as string) || ''
  const effectiveOwner = ownerId || claims.sub
  if (ownerId && ownerId !== claims.sub) return res.status(403).json({ ok: false, error: 'forbidden_owner_mismatch' })
  if (!effectiveOwner || (!name && !contactId)) return res.status(400).json({ ok: false, error: 'ownerId and (name or contactId) required' })
  if (!rateLimit(`del:${effectiveOwner}`)) return res.status(429).json({ ok: false, error: 'rate_limited' })
  try {
    if (isMongoConnected()) {
      const filter: any = { ownerId: effectiveOwner }
      if (contactId) filter.contactId = contactId
      else filter.name = name
      await Contact.deleteOne(filter)
      return res.json({ ok: true })
    }
    const set = inMemContacts.get(effectiveOwner) || new Set<string>()
    const key = `${name || ''}|${contactId || ''}`
    set.delete(key)
    inMemContacts.set(effectiveOwner, set)
    return res.json({ ok: true })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'failed' })
  }
})

// Presence: store online user ids in Redis set per room (or global)
app.get('/presence', async (req, res) => {
  const room = req.query.room as string | undefined
  if (!redis) return res.status(200).json({ ok: false, reason: 'no redis' })
  const key = room ? `presence:${room}` : 'presence:global'
  const ids = await redis.smembers(key)
  res.json({ ids })
})

// Group call logs (in-memory)
app.get('/calls', (req, res) => {
  const anyIo = io as any
  const logs = Array.isArray(anyIo.__callLogs) ? anyIo.__callLogs : []
  res.json({ logs })
})

// Typing indicators: get typing users for a room
app.get('/typing', async (req, res) => {
  const room = req.query.room as string | undefined
  if (!redis) return res.status(200).json({ ok: false, reason: 'no redis' })
  const key = room ? `typing:${room}` : 'typing:global'
  const ids = await redis.smembers(key)
  res.json({ ids })
})

function startListening(port: number, retries = 10) {
  const onError = (err: any) => {
    if (err && (err as any).code === 'EADDRINUSE' && retries > 0) {
      console.warn(`Port ${port} in use, trying ${port + 1}...`)
      server.removeListener('error', onError)
      // try next port
      startListening(port + 1, retries - 1)
    } else {
      console.error('Failed to start server:', err)
      process.exit(1)
    }
  }
  server.once('error', onError)
  server.listen(port, () => {
    server.removeListener('error', onError)
    console.log(`Echo server listening on http://localhost:${port}`)
  })
}

startListening(BASE_PORT)
