// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Background3D from './Background3D'
import './styles.css'
import { io, Socket } from 'socket.io-client'
import type { ChatMessage, CallMedia, CallOffer, CallAnswer, CallIce, CallInvite, CallParticipants, Contact } from './types'

declare global {
  interface ImportMetaEnv {
    readonly VITE_SOCKET_URL?: string
    readonly [key: string]: string | boolean | undefined
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000'
const TURN_URL = (import.meta.env as any).VITE_TURN_URL as string | undefined
const TURN_USERNAME = (import.meta.env as any).VITE_TURN_USERNAME as string | undefined
const TURN_CREDENTIAL = (import.meta.env as any).VITE_TURN_CREDENTIAL as string | undefined
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...(TURN_URL ? [{ urls: TURN_URL, username: TURN_USERNAME, credential: TURN_CREDENTIAL }] : []),
]

let socket: Socket | null = null

// Simple auth token store
function getToken() {
  try { return localStorage.getItem('echo:token') || '' } catch { return '' }
}
function setToken(t: string) {
  try { localStorage.setItem('echo:token', t) } catch {}
}

export default function App() {
  const [name, setName] = useState('123')
  const [joined, setJoined] = useState(false)
  const [msg, setMsg] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [users, setUsers] = useState<Array<{name?: string}>>([])
  const [room, setRoom] = useState<string | null>('6898')
  const listRef = useRef<HTMLDivElement | null>(null)
  const [lowPower, setLowPower] = useState(false)
  const [autoLow, setAutoLow] = useState(false)
  const isMobile = useMemo(() => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent), [])

  // --- Call state ---
  const [inCallWith, setInCallWith] = useState<string | null>(null)
  const [callMedia, setCallMedia] = useState<CallMedia>('audio')
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  // Multi-peer structures for group calls (mesh)
  const [activeCallId, setActiveCallId] = useState<string | null>(null)
  const peerMapRef = useRef<Map<string, RTCPeerConnection>>(new Map()) // socketId -> RTCPeerConnection
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map()) // socketId -> MediaStream
  const [remotePeers, setRemotePeers] = useState<string[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [inputMics, setInputMics] = useState<MediaDeviceInfo[]>([])
  const [inputCams, setInputCams] = useState<MediaDeviceInfo[]>([])
  const [selectedMic, setSelectedMic] = useState<string | undefined>(undefined)
  const [selectedCam, setSelectedCam] = useState<string | undefined>(undefined)
  const [screenSharing, setScreenSharing] = useState(false)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)
  const [incomingOffer, setIncomingOffer] = useState<{ from: string; sdp: RTCSessionDescriptionInit; media: CallMedia } | null>(null)
  const [ringing, setRinging] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const oscRef = useRef<OscillatorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const ringTimeoutRef = useRef<number | null>(null)
  const incomingTimeoutRef = useRef<number | null>(null)
  const incomingOfferRef = useRef<{ from: string; sdp: RTCSessionDescriptionInit; media: CallMedia } | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [ringingWith, setRingingWith] = useState<string | null>(null)
  const callerTimeoutRef = useRef<number | null>(null)
  const callStartRef = useRef<number | null>(null)
  const [elapsed, setElapsed] = useState<string>('00:00')
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | undefined>(undefined)
  const [callLogs, setCallLogs] = useState<Array<{ callId: string; room: string | null; type: string; startedAt: number; endedAt?: number; initiator: string; participants: string[] }>>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  // Owner identity: stable id per device/session
  const [ownerId] = useState<string>(() => {
    try {
      const key = 'echo:ownerId'
      const existing = localStorage.getItem(key)
      if (existing) return existing
      const gen = 'u_' + Math.random().toString(36).slice(2)
      localStorage.setItem(key, gen)
      return gen
    } catch { return 'u_' + Math.random().toString(36).slice(2) }
  })
  const ownerName = name
  const [authToken, setAuthToken] = useState<string>(() => getToken())

  function addSystemMessage(text: string, id: string) {
    setMessages((s) => [...s, { id, name: 'System', text, ts: Date.now() }])
  }

  useEffect(() => {
    if (isMobile) setLowPower(true)
  }, [isMobile])

  useEffect(() => {
    if (joined && !socket) {
      socket = io(SOCKET_URL)

      socket.on('connect', () => {
        socket?.emit('join', { name, userId: ownerId })
      })

      socket.on('message', (m: ChatMessage) => {
        setMessages((s) => [...s, m])
      })

      socket.on('users', (u: Array<{name?: string}>) => {
        setUsers(u)
      })

      socket.on('usersInRoom', (u: Array<{name?: string}>) => {
        // if you're in a room, show users in that room instead
        setUsers(u)
      })

      socket.on('user:join', (u) => {
        setMessages((s) => [...s, { id: u.id, name: 'System', text: `${u.name} joined`, ts: Date.now() }])
      })

      socket.on('user:leave', (u) => {
        setMessages((s) => [...s, { id: u.id, name: 'System', text: `${u.name} left`, ts: Date.now() }])
      })

      // --- Signaling events ---
      socket.on('webrtc:offer', async ({ from, sdp, media, callId }: CallOffer) => {
        // Group renegotiation
        if (activeCallId && callId && callId === activeCallId) {
          const pc = getOrCreatePeer(from)
          await pc.setRemoteDescription(new RTCSessionDescription(sdp))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          socket?.emit('webrtc:answer', { to: from, sdp: answer, callId })
          return
        }
        // 1:1 renegotiation with same peer
        if (inCallWith && inCallWith === from) {
          if (!pcRef.current) await ensurePeer(media)
          if (!pcRef.current) return
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp))
          const answer = await pcRef.current.createAnswer()
          await pcRef.current.setLocalDescription(answer)
          socket?.emit('webrtc:answer', { to: from, sdp: answer })
          setCallMedia(media)
          return
        }
        // If in another call with someone else, signal busy
        if (inCallWith || activeCallId) {
          socket?.emit('call:busy', { to: from })
          return
        }
        const offer = { from, sdp, media }
        setIncomingOffer(offer)
        incomingOfferRef.current = offer
        startRingtone()
        // Auto-decline after 30s if unanswered
        if (incomingTimeoutRef.current) { clearTimeout(incomingTimeoutRef.current); incomingTimeoutRef.current = null }
        incomingTimeoutRef.current = window.setTimeout(() => {
          if (incomingOfferRef.current && incomingOfferRef.current.from === from) {
            declineIncoming()
          }
        }, 30000)
      })
      socket.on('webrtc:answer', async ({ from, sdp }: CallAnswer) => {
        // Handle both 1:1 and group answers
        const pc = peerMapRef.current.get(from) || pcRef.current
        if (!pc) return
        await pc.setRemoteDescription(new RTCSessionDescription(sdp))
        if (callerTimeoutRef.current) { clearTimeout(callerTimeoutRef.current); callerTimeoutRef.current = null }
        setRingingWith(null)
      })
      socket.on('webrtc:ice', async ({ from, candidate }: CallIce) => {
        const pc = peerMapRef.current.get(from) || pcRef.current
        if (!pc || !candidate) return
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
      })
      socket.on('webrtc:end', ({ from }) => {
        if (inCallWith) endCall()
        // In group call, a peer leaving should close just that connection
        const pc = peerMapRef.current.get(from)
        if (pc) {
          try { pc.close() } catch {}
          peerMapRef.current.delete(from)
          remoteStreamsRef.current.delete(from)
          setRemotePeers(Array.from(remoteStreamsRef.current.keys()))
        }
        if (incomingOffer && incomingOffer.from === from) {
          stopRingtone()
          setIncomingOffer(null)
        }
        if (incomingTimeoutRef.current) { clearTimeout(incomingTimeoutRef.current); incomingTimeoutRef.current = null }
        incomingOfferRef.current = null
        // If caller was ringing and callee declined/ended, mark declined
        if (ringingWith === from) {
          const name = (users as any[]).find(u => u.id === from)?.name || 'User'
          addSystemMessage(`Call to ${name} was declined`, from)
          if (callerTimeoutRef.current) { clearTimeout(callerTimeoutRef.current); callerTimeoutRef.current = null }
          setRingingWith(null)
        }
      })

      // Group call orchestration
      socket.on('call:invite', ({ callId, type, from, fromName }: CallInvite) => {
        if (inCallWith || activeCallId) {
          // busy; ignore or could send a busy signal in future
          return
        }
        setIncomingOffer({ from, sdp: {} as any, media: type }) // reuse modal with type and from
        incomingOfferRef.current = { from, sdp: {} as any, media: type }
        // flag that this is a group call by storing a callId
        ;(incomingOfferRef.current as any).callId = callId
        ;(incomingOffer as any)?.callId
        startRingtone()
        if (incomingTimeoutRef.current) { clearTimeout(incomingTimeoutRef.current); incomingTimeoutRef.current = null }
        incomingTimeoutRef.current = window.setTimeout(() => {
          if (incomingOfferRef.current && (incomingOfferRef.current as any).callId === callId) {
            declineIncoming()
          }
        }, 30000)
      })
      socket.on('call:participants', ({ callId, participants }: CallParticipants) => {
        if (activeCallId !== callId) return
        setRemotePeers(participants.filter((id) => id !== socket?.id))
      })
      socket.on('call:endAll', ({ callId }: { callId: string }) => {
        if (activeCallId === callId) {
          endCall()
        }
      })
    }

    return () => {
      // do not disconnect to keep session between renders in dev; uncomment to fully cleanup
      // socket?.disconnect(); socket = null;
    }
  }, [joined, name])

  useEffect(() => {
    // scroll to bottom
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  async function loginIfNeeded() {
    if (authToken) return authToken
    try {
      const r = await fetch(SOCKET_URL + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: ownerId, name })
      })
      const j = await r.json()
      if (j?.ok && j.token) {
        setToken(j.token)
        setAuthToken(j.token)
        return j.token as string
      }
    } catch {}
    return ''
  }

  // Contacts: load from server (fallback to localStorage), and persist to both
  async function loadContacts() {
    const token = authToken || await loginIfNeeded()
    try {
      const r = await fetch(SOCKET_URL + '/contacts?ownerId=' + encodeURIComponent(ownerId), {
        headers: token ? { 'Authorization': 'Bearer ' + token } : undefined
      })
      if (r.status === 401) {
        // try one re-login
        const newTok = await loginIfNeeded()
        if (newTok) {
          const rr = await fetch(SOCKET_URL + '/contacts?ownerId=' + encodeURIComponent(ownerId), {
            headers: { 'Authorization': 'Bearer ' + newTok }
          })
          const jj = await rr.json()
          if (jj?.ok && Array.isArray(jj.contacts)) {
            setContacts(jj.contacts)
            try { localStorage.setItem('echo:contacts', JSON.stringify(jj.contacts)) } catch {}
            return
          }
        }
      }
      const j = await r.json()
      if (j?.ok && Array.isArray(j.contacts)) {
        setContacts(j.contacts)
        try { localStorage.setItem('echo:contacts', JSON.stringify(j.contacts)) } catch {}
        return
      }
    } catch {}
    // fallback to local
    try {
      const raw = localStorage.getItem('echo:contacts')
      if (raw) setContacts(JSON.parse(raw))
    } catch {}
  }
  useEffect(() => { loadContacts() }, [])
  useEffect(() => { if (joined) loadContacts() }, [joined, ownerId])
  useEffect(() => {
    try { localStorage.setItem('echo:contacts', JSON.stringify(contacts)) } catch {}
  }, [contacts])

  async function addContact(c: Contact) {
    setContacts((prev) => {
      if (prev.some((x) => x.name === c.name)) return prev
      return [...prev, c]
    })
    const token = authToken || await loginIfNeeded()
    try {
      await fetch(SOCKET_URL + '/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
        body: JSON.stringify({ ownerId, ownerName, name: c.name, contactId: c.id })
      })
    } catch {}
  }
  async function removeContact(contactName: string) {
    const toRemove = contacts.find((c) => c.name === contactName)
    setContacts((prev) => prev.filter((c) => c.name !== contactName))
    const token = authToken || await loginIfNeeded()
    try {
      const qs = new URLSearchParams({ ownerId, name: contactName })
      if (toRemove?.id) qs.set('contactId', toRemove.id)
      await fetch(SOCKET_URL + '/contacts?' + qs.toString(), { method: 'DELETE', headers: token ? { 'Authorization': 'Bearer ' + token } : undefined })
    } catch {}
  }

  // Fetch call history periodically
  useEffect(() => {
    if (!joined) return
    const origin = SOCKET_URL
    const fetchLogs = async () => {
      try {
        const r = await fetch(origin + '/calls')
        const j = await r.json()
        if (j && Array.isArray(j.logs)) setCallLogs(j.logs.slice(-20))
      } catch {}
    }
    fetchLogs()
    const id = window.setInterval(fetchLogs, 15000)
    return () => window.clearInterval(id)
  }, [joined])

  async function ensurePeer(media: CallMedia) {
    // Create peer connection if needed, with Google STUN servers
    if (!pcRef.current) {
      pcRef.current = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pcRef.current.onicecandidate = (e) => {
        if (e.candidate && inCallWith) socket?.emit('webrtc:ice', { to: inCallWith, candidate: e.candidate.toJSON() })
      }
      pcRef.current.ontrack = (e) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]
      }
      pcRef.current.onconnectionstatechange = () => {
        const st = pcRef.current?.connectionState
        if (st === 'disconnected' || st === 'failed' || st === 'closed') {
          endCall()
        }
      }
    }

    // Get or update local media according to chosen type
    if (!localStreamRef.current) {
      const constraints: MediaStreamConstraints = media === 'video'
        ? { video: { width: { ideal: 640 }, height: { ideal: 360 }, deviceId: selectedCam ? { exact: selectedCam } : undefined } as any, audio: { deviceId: selectedMic ? { exact: selectedMic } : undefined } as any }
        : { audio: { deviceId: selectedMic ? { exact: selectedMic } : undefined } as any }
      localStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints)
      localStreamRef.current.getTracks().forEach((t) => pcRef.current!.addTrack(t, localStreamRef.current!))
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current
    }
  }

  // in-call timer
  useEffect(() => {
    if (!(inCallWith || activeCallId)) return
    if (!callStartRef.current) callStartRef.current = Date.now()
    const id = window.setInterval(() => {
      if (!callStartRef.current) return
      const dur = Date.now() - callStartRef.current
      const mm = Math.floor(dur / 60000)
      const ss = Math.floor((dur % 60000) / 1000)
      setElapsed(`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`)
    }, 1000)
    return () => window.clearInterval(id)
  }, [inCallWith, activeCallId])

  // Mesh helper: create or get a peer connection for a remote id
  function getOrCreatePeer(remoteId: string) {
    let pc = peerMapRef.current.get(remoteId)
    if (pc) return pc
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc.onicecandidate = (e) => {
      if (e.candidate && socket) socket.emit('webrtc:ice', { to: remoteId, candidate: e.candidate.toJSON(), callId: activeCallId || undefined })
    }
    pc.ontrack = (e) => {
      remoteStreamsRef.current.set(remoteId, e.streams[0])
      setRemotePeers(Array.from(remoteStreamsRef.current.keys()))
    }
    pc.onconnectionstatechange = () => {
      const st = pc?.connectionState
      if (st === 'disconnected' || st === 'failed' || st === 'closed') {
        try { pc.close() } catch {}
        peerMapRef.current.delete(remoteId)
        remoteStreamsRef.current.delete(remoteId)
        setRemotePeers(Array.from(remoteStreamsRef.current.keys()))
      }
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => pc!.addTrack(t, localStreamRef.current!))
    }
    peerMapRef.current.set(remoteId, pc)
    return pc
  }

  async function connectToPeer(remoteId: string) {
    const pc = getOrCreatePeer(remoteId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket?.emit('webrtc:offer', { to: remoteId, sdp: offer, media: callMedia, callId: activeCallId || undefined })
  }

  // when participants update in a group call, connect to any new ones
  useEffect(() => {
    if (!activeCallId) return
    remotePeers.forEach((pid) => {
      if (!peerMapRef.current.has(pid)) {
        getOrCreatePeer(pid)
        if (socket?.id && socket.id < pid) connectToPeer(pid)
      }
    })
  }, [remotePeers, activeCallId])

  async function startCall(targetSocketId: string, media: CallMedia) {
    await ensurePeer(media)
    setInCallWith(targetSocketId)
    setCallMedia(media)
    const offer = await pcRef.current!.createOffer()
    await pcRef.current!.setLocalDescription(offer)
    socket?.emit('webrtc:offer', { to: targetSocketId, sdp: offer, media })
    // show ringing UI until answered/declined/ended
    setRingingWith(targetSocketId)
    if (callerTimeoutRef.current) { clearTimeout(callerTimeoutRef.current); callerTimeoutRef.current = null }
    callerTimeoutRef.current = window.setTimeout(() => {
      if (ringingWith === targetSocketId) {
        const name = (users as any[]).find(u => u.id === targetSocketId)?.name || 'User'
        addSystemMessage(`Missed ${media === 'video' ? 'video' : 'voice'} call to ${name}`, targetSocketId)
        setRingingWith(null)
        // End the local call attempt
        endCall()
      }
    }, 30000)
    callStartRef.current = Date.now()
  }

  async function enableVideo() {
    if (!inCallWith) return
    await ensurePeer('video')
    setCallMedia('video')
    const offer = await pcRef.current!.createOffer()
    await pcRef.current!.setLocalDescription(offer)
    socket?.emit('webrtc:offer', { to: inCallWith, sdp: offer, media: 'video' })
  }

  function endCall() {
    if (inCallWith && socket) socket.emit('webrtc:end', { to: inCallWith })
    if (activeCallId && socket) socket.emit('call:leave', { callId: activeCallId })
    pcRef.current?.getSenders().forEach((s) => { try { s.track?.stop() } catch {} })
    localStreamRef.current?.getTracks().forEach((t) => { try { t.stop() } catch {} })
    pcRef.current?.close()
    pcRef.current = null
    localStreamRef.current = null
    // close group peers
    peerMapRef.current.forEach((pc) => { try { pc.close() } catch {} })
    peerMapRef.current.clear()
    remoteStreamsRef.current.clear()
    setRemotePeers([])
    // If still ringing and not connected, this is a canceled call
    if (ringingWith) {
      const name = (users as any[]).find(u => u.id === ringingWith)?.name || 'User'
      addSystemMessage(`Canceled call to ${name}`, ringingWith)
    }
    setInCallWith(null)
    setMuted(false)
    setCameraOff(false)
    if (callerTimeoutRef.current) { clearTimeout(callerTimeoutRef.current); callerTimeoutRef.current = null }
    setRingingWith(null)
    setActiveCallId(null)
    if (screenTrackRef.current) { try { screenTrackRef.current.stop() } catch {}; screenTrackRef.current = null; setScreenSharing(false) }
    // log duration
    if (callStartRef.current) {
      const dur = Date.now() - callStartRef.current
      const mm = Math.floor(dur / 60000)
      const ss = Math.floor((dur % 60000) / 1000)
      const withName = inCallWith ? ((users as any[]).find(u=>u.id===inCallWith)?.name || 'User') : 'Group'
      addSystemMessage(`Call with ${withName} ended (${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')})`, inCallWith || 'group')
      callStartRef.current = null
      setElapsed('00:00')
    }
  }

  // --- Ringtone helpers ---
  function startRingtone() {
    if (ringing) return
    setRinging(true)
    const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext
  if (!AC) return
  if (!audioCtxRef.current) audioCtxRef.current = new AC()
  const ctx = audioCtxRef.current
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 800
    gain.gain.value = 0
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    oscRef.current = osc
    gainRef.current = gain

    const ringOnce = () => {
  if (!gainRef.current || !audioCtxRef.current) return
  const t0 = audioCtxRef.current.currentTime
      gainRef.current.gain.cancelScheduledValues(t0)
      gainRef.current.gain.setValueAtTime(0.0, t0)
      gainRef.current.gain.linearRampToValueAtTime(0.22, t0 + 0.05)
      gainRef.current.gain.linearRampToValueAtTime(0.0, t0 + 1.0)
      ringTimeoutRef.current = window.setTimeout(ringOnce, 1500)
    }
    ringOnce()
  }

  function stopRingtone() {
    setRinging(false)
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null }
    try { gainRef.current?.disconnect() } catch {}
    try { oscRef.current?.stop() } catch {}
    try { oscRef.current?.disconnect() } catch {}
    oscRef.current = null
    gainRef.current = null
    // Don't close context to avoid user gesture restrictions; just suspend.
    audioCtxRef.current?.suspend().catch(() => {})
  }

  async function acceptIncoming() {
    // Group invite acceptance
    if (incomingOfferRef.current && (incomingOfferRef.current as any).callId) {
      const cid = (incomingOfferRef.current as any).callId as string
      const type = incomingOfferRef.current.media
      await acceptIncomingGroup(cid, type)
      return
    }
    if (!incomingOffer) return
    stopRingtone()
    if (incomingTimeoutRef.current) { clearTimeout(incomingTimeoutRef.current); incomingTimeoutRef.current = null }
    const { from, sdp, media } = incomingOffer
    await ensurePeer(media)
    if (!pcRef.current) return
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await pcRef.current.createAnswer()
    await pcRef.current.setLocalDescription(answer)
    socket?.emit('webrtc:answer', { to: from, sdp: answer })
    setInCallWith(from)
    setCallMedia(media)
    setIncomingOffer(null)
    incomingOfferRef.current = null
    callStartRef.current = Date.now()
  }

  function declineIncoming() {
    if (!incomingOffer) return
    stopRingtone()
    socket?.emit('webrtc:end', { to: incomingOffer.from })
    setIncomingOffer(null)
    if (incomingTimeoutRef.current) { clearTimeout(incomingTimeoutRef.current); incomingTimeoutRef.current = null }
    incomingOfferRef.current = null
    // Missed call (declined) message for local callee
    const name = (users as any[]).find(u => u.id === incomingOffer.from)?.name || 'User'
    addSystemMessage(`Missed ${incomingOffer.media === 'video' ? 'video' : 'voice'} call from ${name}`, incomingOffer.from)
  }

  // --- In-call controls ---
  function toggleMute() {
    const stream = localStreamRef.current
    if (!stream) return
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length > 0) {
      const enabled = audioTracks[0].enabled
      audioTracks[0].enabled = !enabled
      setMuted(enabled) // if it was enabled, now muted
    }
  }

  function toggleCamera() {
    if (callMedia !== 'video') return
    const stream = localStreamRef.current
    if (!stream) return
    const videoTracks = stream.getVideoTracks()
    if (videoTracks.length > 0) {
      const enabled = videoTracks[0].enabled
      videoTracks[0].enabled = !enabled
      setCameraOff(enabled) // if it was enabled, now off
    }
  }

  // Device enumeration
  useEffect(() => {
    async function loadDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setInputMics(devices.filter((d) => d.kind === 'audioinput'))
        setInputCams(devices.filter((d) => d.kind === 'videoinput'))
        setOutputDevices(devices.filter((d) => d.kind === 'audiooutput'))
      } catch {}
    }
    loadDevices()
    navigator.mediaDevices.addEventListener?.('devicechange', loadDevices)
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', loadDevices)
  }, [])

  // Apply selected output device if supported
  useEffect(() => {
    const el = remoteVideoRef.current as any
    if (!el || !selectedSpeaker) return
    if (typeof el.setSinkId === 'function') {
      el.setSinkId(selectedSpeaker).catch(() => {})
    }
  }, [selectedSpeaker])

  async function changeMic(deviceId: string) {
    setSelectedMic(deviceId)
    if (!localStreamRef.current) return
    const constraints: MediaStreamConstraints = { audio: { deviceId: { exact: deviceId } } as any, video: callMedia === 'video' }
    const newStream = await navigator.mediaDevices.getUserMedia(constraints)
    const track = newStream.getAudioTracks()[0]
    const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'audio')
    if (sender && track) sender.replaceTrack(track)
    localStreamRef.current.getAudioTracks().forEach((t) => t.stop())
    localStreamRef.current.addTrack(track)
  }

  async function changeCam(deviceId: string) {
    setSelectedCam(deviceId)
    if (!localStreamRef.current) return
    const constraints: MediaStreamConstraints = { video: { deviceId: { exact: deviceId } } as any, audio: true }
    const newStream = await navigator.mediaDevices.getUserMedia(constraints)
    const track = newStream.getVideoTracks()[0]
    const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video')
    if (sender && track) sender.replaceTrack(track)
    localStreamRef.current.getVideoTracks().forEach((t) => t.stop())
    localStreamRef.current.addTrack(track)
    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current
  }

  async function startScreenShare() {
    try {
      const ms = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false })
      const track: MediaStreamTrack | undefined = ms.getVideoTracks()[0]
      if (!track) return
      screenTrackRef.current = track
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video')
      if (sender) await sender.replaceTrack(track)
      setScreenSharing(true)
      track.onended = () => stopScreenShare()
    } catch {}
  }
  async function stopScreenShare() {
    const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video')
    const orig = localStreamRef.current?.getVideoTracks()[0]
    if (sender && orig) await sender.replaceTrack(orig)
    if (screenTrackRef.current) { try { screenTrackRef.current.stop() } catch {} }
    screenTrackRef.current = null
    setScreenSharing(false)
  }

  // Group call: invite the current room
  async function inviteRoomCall(type: CallMedia) {
    if (!socket) return
    const callId = Math.random().toString(36).slice(2)
    setActiveCallId(callId)
    setCallMedia(type)
    socket.emit('call:invite', { callId, room, type })
    socket.emit('call:join', { callId })
    await ensurePeer(type)
    callStartRef.current = Date.now()
  }

  async function acceptIncomingGroup(callId: string, type: CallMedia) {
    if (!socket) return
    setActiveCallId(callId)
    setCallMedia(type)
    stopRingtone()
    if (incomingTimeoutRef.current) { clearTimeout(incomingTimeoutRef.current); incomingTimeoutRef.current = null }
    setIncomingOffer(null)
    incomingOfferRef.current = null
    // Join call and establish mesh connections to participants as they arrive via participants event
    socket.emit('call:join', { callId })
    await ensurePeer(type)
  }

  function send() {
    if (!msg.trim() || !socket) return
    socket.emit('message', { text: msg, room })
    setMsg('')
  }

  if (!joined) {
    return (
      <div className="center">
        <Background3D lowPower={lowPower} onAutoLowPower={(v) => { setLowPower(v); setAutoLow(true) }} />
        <div className="card">
          <h2>Echo — join chat</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input id="lp-toggle" type="checkbox" checked={lowPower} onChange={(e) => { setLowPower(e.target.checked); setAutoLow(false) }} />
            <label htmlFor="lp-toggle">Low Power Mode {autoLow && <span style={{ color: '#93c5fd' }}>(auto)</span>}</label>
          </div>
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Room (optional)" value={room || ''} onChange={(e) => setRoom(e.target.value || null)} />
          <button disabled={!name.trim()} onClick={() => {
            setJoined(true)
            // when we will connect, client effect will join the room
          }}>Join</button>
        </div>
      </div>
    )
  }

  // when joined and socket exists, emit joinRoom if a room was specified
  useEffect(() => {
    if (joined && socket && room) {
      socket.emit('joinRoom', room)
    }
  }, [joined, room])

  return (
    <div className="app">
      <Background3D lowPower={lowPower} onAutoLowPower={(v) => { setLowPower(v); setAutoLow(true) }} />
      {/* Incoming call modal */}
      {incomingOffer && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Incoming {incomingOffer.media === 'video' ? 'video' : 'voice'} call</h3>
            <p>From: {(users as any[]).find(u => u.id === incomingOffer.from)?.name || 'Unknown'}</p>
            <div className="actions">
              <button className="accept" onClick={acceptIncoming}>{incomingOffer.media === 'video' ? 'Accept Video' : 'Accept Audio'}</button>
              <button className="decline" onClick={declineIncoming}>Decline</button>
            </div>
          </div>
        </div>
      )}
      <div className="lp-toggle">
        <input id="lp-toggle-main" type="checkbox" checked={lowPower} onChange={(e) => { setLowPower(e.target.checked); setAutoLow(false) }} />
        <label htmlFor="lp-toggle-main">Low Power{autoLow ? ' (auto)' : ''}</label>
      </div>
      <aside className="sidebar">
        <h3>Users</h3>
        <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
          <button onClick={() => inviteRoomCall('audio')} disabled={!room}>Start room voice</button>
          <button onClick={() => inviteRoomCall('video')} disabled={!room}>Start room video</button>
        </div>
        {/* Device selection */}
        <div style={{ display:'grid', gap:6, marginBottom:10 }}>
          {!!inputMics.length && (
            <select value={selectedMic || ''} onChange={(e) => changeMic(e.target.value)}>
              <option value="">Default microphone</option>
              {inputMics.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
            </select>
          )}
          {!!inputCams.length && (
            <select value={selectedCam || ''} onChange={(e) => changeCam(e.target.value)}>
              <option value="">Default camera</option>
              {inputCams.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
            </select>
          )}
          {!!outputDevices.length && (
            <select value={selectedSpeaker || ''} onChange={(e) => setSelectedSpeaker(e.target.value)}>
              <option value="">Default speaker</option>
              {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speaker'}</option>)}
            </select>
          )}
        </div>
        <ul>
          {users.map((u: any, i) => (
            <li key={u.id || i}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span>{u.name || 'Anonymous'}</span>
                {socket?.id !== u.id && (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button title="Voice call" onClick={() => startCall(u.id, 'audio')}>📞</button>
                    <button title="Video call" onClick={() => startCall(u.id, 'video')}>🎥</button>
                    <button title="Add contact" onClick={() => addContact({ id: u.userId || u.id, name: u.name || 'Anonymous' })}>➕</button>
                    {activeCallId && <button title="Invite to group call" onClick={() => socket?.emit('call:invite', { callId: activeCallId, room, type: callMedia, to: u.id })}>➕</button>}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {/* Call history (last 20 entries) */}
        <div style={{ marginTop: 12 }}>
          <h4 style={{ margin: '8px 0' }}>Call history</h4>
          <div style={{ maxHeight: 160, overflow: 'auto', fontSize: 12, color: '#cbd5e1' }}>
            {callLogs.length === 0 && <div>No calls yet</div>}
            {callLogs.slice().reverse().map((c) => (
              <div key={c.callId + ':' + c.startedAt} style={{ marginBottom: 6 }}>
                <div><strong>{c.type}</strong> • {(c.room || 'global')} • {new Date(c.startedAt).toLocaleTimeString()}</div>
                <div style={{ opacity: 0.75 }}>by {c.initiator.slice(0,6)} • {c.participants.length} participants{c.endedAt ? '' : ' • live'}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Contacts */}
        <div style={{ marginTop: 12 }}>
          <h3>Contacts</h3>
          <div style={{ display:'grid', gap:6 }}>
            <div style={{ display:'flex', gap:6 }}>
              <input id="new-contact-name" placeholder="Contact name" style={{ flex:1 }} />
              <button onClick={() => {
                const el = document.getElementById('new-contact-name') as HTMLInputElement | null
                const val = el?.value?.trim()
                if (val) { addContact({ name: val }); if (el) el.value = '' }
              }}>Add contact</button>
            </div>
            {contacts.length === 0 && <div style={{ color:'#9aa6bf', fontSize:12 }}>No contacts yet</div>}
            <ul>
              {contacts.map((c) => (
                <li key={c.name} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
                  <span>
                    {c.name}
                    {'online' in c && (c as any).online !== undefined && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: (c as any).online ? '#34d399' : '#9aa6bf' }}>
                        {(c as any).online ? '• online' : '• offline'}
                      </span>
                    )}
                  </span>
                  <span style={{ display:'flex', gap:4 }}>
                    {(() => {
                      const match = (users as any[]).find(x => (c.id && x.userId === c.id) || x.name === c.name)
                      return match ? (
                        <>
                          <button title="Voice call" onClick={() => startCall(match.id, 'audio')}>📞</button>
                          <button title="Video call" onClick={() => startCall(match.id, 'video')}>🎥</button>
                        </>
                      ) : null
                    })()}
                    <button title="Remove" onClick={() => removeContact(c.name)}>✖</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <main className="chat">
        {/* Call surface */}
        {(inCallWith || activeCallId) && (
          <div className="call-surface">
            <div className="videos">
              <video ref={remoteVideoRef} autoPlay playsInline muted={false} className="remote" />
              {callMedia === 'video' && (
                <video ref={localVideoRef} autoPlay playsInline muted className="local" />
              )}
            </div>
            <div className="call-controls">
              {ringingWith && (
                <span className="ringing">Ringing…</span>
              )}
              <button onClick={toggleMute} className={"control " + (muted ? 'active' : '')} title={muted ? 'Unmute mic' : 'Mute mic'}>
                {muted ? 'Unmute' : 'Mute'}
              </button>
              {callMedia === 'video' && (
                <button onClick={toggleCamera} className={"control " + (cameraOff ? 'active' : '')} title={cameraOff ? 'Turn camera on' : 'Turn camera off'}>
                  {cameraOff ? 'Camera On' : 'Camera Off'}
                </button>
              )}
              {inCallWith && callMedia === 'audio' && (
                <button onClick={enableVideo} className="control" title="Switch to video">Enable Video</button>
              )}
              {callMedia === 'video' && !screenSharing && (
                <button onClick={startScreenShare} className="control" title="Share screen">Share screen</button>
              )}
              {callMedia === 'video' && screenSharing && (
                <button onClick={stopScreenShare} className="control" title="Stop sharing">Stop share</button>
              )}
              {activeCallId && (
                <button onClick={() => socket?.emit('call:endAll', { callId: activeCallId })} className="control" title="End for all">End for all</button>
              )}
              <button onClick={endCall} className="hangup">End Call</button>
            </div>
          </div>
        )}
        {/* Group call remote tiles (mesh). Simplified: show IDs; full video grid out of scope for brevity */}
        {activeCallId && remotePeers.length > 0 && (
          <div style={{ position:'fixed', left:12, bottom:12, zIndex:3, background:'rgba(0,0,0,0.25)', padding:8, borderRadius:8 }}>
            <div style={{ fontSize:12, opacity:0.8, marginBottom:6 }}>In group call • {remotePeers.length} peers</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', maxWidth:480 }}>
              {remotePeers.map(pid => (
                <div key={pid} style={{ width:120, height:80, background:'#000', border:'1px solid rgba(255,255,255,0.1)' }}>
                  {/* In a full implementation, attach per-peer video elements here */}
                  <div style={{ fontSize:11, padding:4, color:'#cbd5e1' }}>{(users as any[]).find(u=>u.id===pid)?.name || pid.slice(0,6)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="messages" ref={listRef}>
          {messages.map((m) => (
            <div key={m.ts + m.id} className={`message ${m.name === 'System' ? 'system' : ''}`}>
              <div className="meta"><strong>{m.name}</strong> <span className="time">{new Date(m.ts).toLocaleTimeString()}</span></div>
              <div className="text">{m.text}</div>
            </div>
          ))}
        </div>

        <div className="composer">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }} placeholder="Type a message..." />
          <button onClick={send}>Send</button>
        </div>
      </main>
    </div>
  )
}
