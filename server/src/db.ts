// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI || ''
const USE_INMEMORY_MONGO = process.env.USE_INMEMORY_MONGO === '1' || process.env.USE_INMEMORY_MONGO === 'true'

async function startInMemoryMongo() {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server')
    const mem = await MongoMemoryServer.create()
    const uri = mem.getUri('echo')
    console.log(`Started in-memory MongoDB at ${uri}`)
    await mongoose.connect(uri)
    console.log('Connected to in-memory MongoDB')
    mongoConnected = true
  } catch (err) {
    console.error('Failed to start in-memory MongoDB:', err)
  }
}

export async function connectToMongo() {
  // If explicitly requested, prefer in-memory MongoDB for dev runs, regardless of MONGODB_URI
  if (USE_INMEMORY_MONGO) {
    console.warn('Using in-memory MongoDB (dev only)')
    await startInMemoryMongo()
    return
  }
  if (!MONGODB_URI) {
    console.warn('MONGODB_URI not set; skipping MongoDB connection')
    return
  }
  const parsed = (() => {
    try {
      const u = new URL(MONGODB_URI)
      return `${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`
    } catch {
      return 'unknown'
    }
  })()

  const maxRetries = 10
  const delayMs = 1000
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Connecting to MongoDB at ${parsed} (attempt ${attempt}/${maxRetries})`)
      await mongoose.connect(MONGODB_URI)
      console.log('Connected to MongoDB')
      mongoConnected = true
      return
    } catch (err) {
      console.error('MongoDB connection error', err)
      if (attempt < maxRetries) {
        await new Promise((res) => setTimeout(res, delayMs))
      }
    }
  }
  console.error('MongoDB connection failed after retries')
  console.error('Continuing without DB')
}

let mongoConnected = false
export function isMongoConnected() {
  return mongoConnected
}

const messageSchema = new mongoose.Schema({ name: String, text: String, ts: Number, room: { type: String, default: null } })
export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema)

// Contacts collection: scope by ownerId (stable user identity)
const contactSchema = new mongoose.Schema({
  ownerId: { type: String, required: true, index: true },
    contactId: { type: String, required: false, index: true },
    name: { type: String, required: false },
    createdAt: { type: Date, default: Date.now },
})
  contactSchema.index({ ownerId: 1, contactId: 1 }, { unique: false })
  contactSchema.index({ ownerId: 1, name: 1 }, { unique: false })
export const Contact = (mongoose.models as any).Contact || mongoose.model('Contact', contactSchema)

export default mongoose
