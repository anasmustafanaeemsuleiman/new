import {
  colorFor,
  normalizeUsername,
  validatePassword,
  validateUsername,
  type AuthInput,
  type ChatBackend,
  type ChatSummary,
  type Message,
  type Profile,
  type ProfilePatch,
} from './types'

const STORE_KEY = 'chatter.local.v1'
const SESSION_KEY = 'chatter.local.session'
const CHANNEL_NAME = 'chatter.local.sync'

type StoredUser = Profile & { passwordHash: string; createdAt: string }
type StoredChat = { id: string; memberIds: string[]; createdAt: string }

type Store = {
  users: StoredUser[]
  chats: StoredChat[]
  messages: Message[]
  reads: Record<string, string>
}

const emptyStore = (): Store => ({ users: [], chats: [], messages: [], reads: {} })

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as Partial<Store>
    return {
      users: parsed.users ?? [],
      chats: parsed.chats ?? [],
      messages: parsed.messages ?? [],
      reads: parsed.reads ?? {},
    }
  } catch {
    return emptyStore()
  }
}

function writeStore(store: Store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store))
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const publicProfile = (user: StoredUser): Profile => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  about: user.about,
  color: user.color,
})

/**
 * Offline backend: keeps accounts, chats and messages in this browser only.
 * It exists so the app is usable without a Supabase project; two tabs of the
 * same browser act as two different signed-in people.
 */
class LocalBackend implements ChatBackend {
  readonly mode = 'local' as const

  private listeners = new Set<() => void>()
  private channel: BroadcastChannel | null = null
  private typingChannel: BroadcastChannel | null = null

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME)
      this.channel.onmessage = () => this.emit()
      this.typingChannel = new BroadcastChannel(`${CHANNEL_NAME}.typing`)
    }
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  private commit(store: Store) {
    writeStore(store)
    this.emit()
    this.channel?.postMessage('changed')
  }

  private sessionId(): string | null {
    try {
      return sessionStorage.getItem(SESSION_KEY)
    } catch {
      return null
    }
  }

  private requireSession(): StoredUser {
    const id = this.sessionId()
    const user = id ? readStore().users.find((candidate) => candidate.id === id) : undefined
    if (!user) throw new Error('You are signed out. Please sign in again.')
    return user
  }

  async currentUser(): Promise<Profile | null> {
    const id = this.sessionId()
    if (!id) return null
    const user = readStore().users.find((candidate) => candidate.id === id)
    return user ? publicProfile(user) : null
  }

  async signUp(input: AuthInput): Promise<Profile> {
    const usernameError = validateUsername(input.username)
    if (usernameError) throw new Error(usernameError)
    const passwordError = validatePassword(input.password)
    if (passwordError) throw new Error(passwordError)

    const username = normalizeUsername(input.username)
    const store = readStore()
    if (store.users.some((user) => user.username === username)) {
      throw new Error('That username is already taken.')
    }

    const user: StoredUser = {
      id: crypto.randomUUID(),
      username,
      displayName: username,
      about: 'Hey there! I am using Chatter.',
      color: colorFor(username),
      passwordHash: await sha256(`${username}:${input.password}`),
      createdAt: new Date().toISOString(),
    }
    store.users.push(user)
    this.commit(store)
    sessionStorage.setItem(SESSION_KEY, user.id)
    return publicProfile(user)
  }

  async signIn(input: AuthInput): Promise<Profile> {
    const username = normalizeUsername(input.username)
    const store = readStore()
    const user = store.users.find((candidate) => candidate.username === username)
    const hash = await sha256(`${username}:${input.password}`)
    if (!user || user.passwordHash !== hash) throw new Error('Wrong username or password.')
    sessionStorage.setItem(SESSION_KEY, user.id)
    return publicProfile(user)
  }

  async signOut(): Promise<void> {
    sessionStorage.removeItem(SESSION_KEY)
  }

  async updateProfile(patch: ProfilePatch): Promise<Profile> {
    const me = this.requireSession()
    const store = readStore()
    const user = store.users.find((candidate) => candidate.id === me.id)
    if (!user) throw new Error('You are signed out. Please sign in again.')

    if (patch.displayName !== undefined) {
      user.displayName = patch.displayName.trim().slice(0, 40) || user.username
    }
    if (patch.about !== undefined) user.about = patch.about.trim().slice(0, 140)
    if (patch.color !== undefined) user.color = patch.color

    this.commit(store)
    return publicProfile(user)
  }

  async isUsernameTaken(username: string): Promise<boolean> {
    const target = normalizeUsername(username)
    return readStore().users.some((user) => user.username === target)
  }

  async findProfile(username: string): Promise<Profile | null> {
    const target = normalizeUsername(username)
    const user = readStore().users.find((candidate) => candidate.username === target)
    return user ? publicProfile(user) : null
  }

  async listChats(): Promise<ChatSummary[]> {
    const me = this.requireSession()
    const store = readStore()

    return store.chats
      .filter((chat) => chat.memberIds.includes(me.id))
      .map<ChatSummary>((chat) => {
        const peerId = chat.memberIds.find((id) => id !== me.id)
        // A chat with no other member is your own "notes to self" chat.
        const isSelf = !peerId
        const peerUser = store.users.find((user) => user.id === (peerId ?? me.id))
        const chatMessages = store.messages
          .filter((message) => message.chatId === chat.id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        const lastMessage = chatMessages[chatMessages.length - 1] ?? null
        const lastReadAt = store.reads[`${chat.id}:${me.id}`] ?? null

        return {
          id: chat.id,
          peer: peerUser ? publicProfile(peerUser) : null,
          isSelf,
          lastMessage,
          unread: lastReadAt
            ? chatMessages.filter(
                (message) => message.senderId !== me.id && message.createdAt > lastReadAt,
              ).length
            : chatMessages.filter((message) => message.senderId !== me.id).length,
          updatedAt: lastMessage?.createdAt ?? chat.createdAt,
          peerLastReadAt: peerId ? store.reads[`${chat.id}:${peerId}`] ?? null : null,
        }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listMessages(chatId: string): Promise<Message[]> {
    const me = this.requireSession()
    const store = readStore()
    const chat = store.chats.find((candidate) => candidate.id === chatId)
    if (!chat || !chat.memberIds.includes(me.id)) return []
    return store.messages
      .filter((message) => message.chatId === chatId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async sendMessage(chatId: string, body: string): Promise<Message> {
    const me = this.requireSession()
    const text = body.trim()
    if (!text) throw new Error('Write something first.')

    const store = readStore()
    const chat = store.chats.find((candidate) => candidate.id === chatId)
    if (!chat || !chat.memberIds.includes(me.id)) throw new Error('That chat is not available.')

    const message: Message = {
      id: crypto.randomUUID(),
      chatId,
      senderId: me.id,
      body: text.slice(0, 2000),
      createdAt: new Date().toISOString(),
    }
    store.messages.push(message)
    store.reads[`${chatId}:${me.id}`] = message.createdAt
    this.commit(store)
    return message
  }

  async startChatWith(username: string): Promise<string> {
    const me = this.requireSession()
    const target = normalizeUsername(username)
    const store = readStore()
    const peer = store.users.find((candidate) => candidate.username === target)
    if (!peer) throw new Error(`No account called @${target} on this device yet.`)
    // Your own username opens the self chat instead of failing.
    if (peer.id === me.id) return this.startSelfChat()

    const existing = store.chats.find(
      (chat) =>
        chat.memberIds.length === 2 &&
        chat.memberIds.includes(me.id) &&
        chat.memberIds.includes(peer.id),
    )
    if (existing) return existing.id

    const chat: StoredChat = {
      id: crypto.randomUUID(),
      memberIds: [me.id, peer.id],
      createdAt: new Date().toISOString(),
    }
    store.chats.push(chat)
    this.commit(store)
    return chat.id
  }

  async startSelfChat(): Promise<string> {
    const me = this.requireSession()
    const store = readStore()
    const existing = store.chats.find(
      (chat) => chat.memberIds.length === 1 && chat.memberIds[0] === me.id,
    )
    if (existing) return existing.id

    const chat: StoredChat = {
      id: crypto.randomUUID(),
      memberIds: [me.id],
      createdAt: new Date().toISOString(),
    }
    store.chats.push(chat)
    this.commit(store)
    return chat.id
  }

  async markRead(chatId: string): Promise<void> {
    const me = this.requireSession()
    const store = readStore()
    store.reads[`${chatId}:${me.id}`] = new Date().toISOString()
    this.commit(store)
  }

  subscribeChanges(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  sendTyping(chatId: string): void {
    const me = this.sessionId()
    if (!me) return
    this.typingChannel?.postMessage({ chatId, userId: me })
  }

  subscribeTyping(chatId: string, callback: (userId: string) => void): () => void {
    const channel = this.typingChannel
    if (!channel) return () => {}
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { chatId?: string; userId?: string } | undefined
      if (data?.chatId === chatId && data.userId) callback(data.userId)
    }
    channel.addEventListener('message', onMessage)
    return () => channel.removeEventListener('message', onMessage)
  }
}

export function createLocalBackend(): ChatBackend {
  return new LocalBackend()
}
