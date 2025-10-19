// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
export type ChatMessage = {
  id: string
  name: string
  text: string
  ts: number
}

export type CallMedia = 'audio' | 'video'
export type CallOffer = { from: string; sdp: RTCSessionDescriptionInit; media: CallMedia; callId?: string }
export type CallAnswer = { from: string; sdp: RTCSessionDescriptionInit; callId?: string }
export type CallIce = { from: string; candidate: RTCIceCandidateInit; callId?: string }

// Group call orchestration types
export type CallType = 'audio' | 'video'
export type CallInvite = { callId: string; type: CallType; from: string; fromName?: string }
export type CallParticipants = { callId: string; participants: string[] }

// Contacts
export type Contact = {
  id?: string // optional socket or stable user id if known
  name: string
  online?: boolean
}
