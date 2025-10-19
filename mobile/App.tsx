// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
import React, { useEffect, useState } from 'react'
import { SafeAreaView, View, Text, TextInput, Button, FlatList, StyleSheet, ListRenderItemInfo } from 'react-native'
import { io, Socket } from 'socket.io-client'

const SOCKET_URL = 'http://localhost:3000'
let socket: Socket | null = null

interface ChatMessage { name?: string; text: string; ts?: number }
interface UserJoinEvent { name: string }

export default function App() {
  const [name, setName] = useState('')
  const [joined, setJoined] = useState(false)
  const [room, setRoom] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])

  useEffect(() => {
    if (!joined) return

    const s = io(SOCKET_URL)
    socket = s

    s.on('connect', () => {
      s.emit('join', name)
      if (room) s.emit('joinRoom', room)
    })
      s.on('message', (m: ChatMessage) => setMessages((prev: ChatMessage[]) => [...prev, m]))
      s.on('user:join', (u: UserJoinEvent) =>
        setMessages((prev: ChatMessage[]) => [
          ...prev,
          { name: 'System', text: `${u.name} joined`, ts: Date.now() }
        ])
      )
      s.on('user:leave', (u: UserJoinEvent) =>
        setMessages((prev: ChatMessage[]) => [
          ...prev,
          { name: 'System', text: `${u.name} left`, ts: Date.now() }
        ])
      )

    return () => {
      s.removeAllListeners()
      s.disconnect()
      socket = null
    }
  }, [joined, name])

  const send = () => {
    if (!msg.trim() || !socket) return
      socket.emit('message', { text: msg, room })
    setMsg('')
  }

  if (!joined) {
    return (
      <SafeAreaView style={styles.center}>
  <Text style={styles.title}>Echo Mobile</Text>
  <TextInput style={styles.input} placeholder="Your name" value={name} onChangeText={setName} />
  <TextInput style={styles.input} placeholder="Room (optional)" value={room || ''} onChangeText={(t: string) => setRoom(t || null)} />
  <Button title="Join" onPress={() => setJoined(true)} disabled={!name.trim()} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <FlatList<ChatMessage>
        data={messages}
        keyExtractor={(_item: ChatMessage, idx: number) => String(idx)}
        renderItem={({ item }: ListRenderItemInfo<ChatMessage>) => (
          <View style={styles.msg}>
            <Text style={styles.meta}>{item.name || 'Unknown'}</Text>
            <Text>{item.text}</Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          style={[styles.input, { flex: 1, marginBottom: 0 }]}
          value={msg}
          onChangeText={setMsg}
          placeholder="Type a message"
        />
        <Button title="Send" onPress={send} />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 24, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', padding: 8, width: '100%', marginBottom: 8 },
  composer: { flexDirection: 'row', padding: 8, borderTopWidth: 1, borderColor: '#eee' },
  msg: { padding: 8, borderBottomWidth: 1, borderColor: '#eee' },
  meta: { fontSize: 12, color: '#666' }
})
