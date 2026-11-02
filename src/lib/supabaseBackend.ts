import { createClient } from '@supabase/supabase-js'
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

/**
 * Supabase auth is email based, so a username is mapped to a deterministic
 * internal address. Users never see or type it — from their point of view the
 * login is "username + password".
 */
const EMAIL_DOMAIN = 'chatter.local'
const emailFor = (username: string) => `${username}@${EMAIL_DOMAIN}`

type ProfileRow = {
  id: string
  username: string
  display_name: string | null
  about: string | null
  color: string | null
}

type MessageRow = {
  id: string
  chat_id: string
  sender_id: string
  body: string
  created_at: string
}

type MemberRow = {
  chat_id: string
  user_id: string
  last_read_at: string | null
  profiles: ProfileRow | ProfileRow[] | null
}

// The project has no generated database types, so the client is intentionally
// untyped at the schema level and rows are narrowed with the Row types above.
const makeClient = (url: string, anonKey: string) =>
  createClient<any>(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 10 } },
  })

type ChatterClient = ReturnType<typeof makeClient>
type Channel = ReturnType<ChatterClient['channel']>

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    about: row.about || '',
    color: row.color || colorFor(row.username),
  }
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  }
}

function friendlyAuthError(message: string): string {
  const text = message.toLowerCase()
  if (text.includes('already registered') || text.includes('duplicate key')) {
    return 'That username is already taken.'
  }
  if (text.includes('invalid login credentials')) {
    return 'Wrong username or password.'
  }
  if (text.includes('password')) {
    return 'That password is too weak — use at least 6 characters.'
  }
  if (text.includes('rate limit') || text.includes('too many')) {
    return 'Too many attempts. Wait a moment and try again.'
  }
  return message
}

class SupabaseBackend implements ChatBackend {
  readonly mode = 'supabase' as const

  private db: ChatterClient
  private cachedMe: Profile | null = null
  private listeners = new Set<() => void>()
  private changeChannel: Channel | null = null
  private typingChannels = new Map<string, Channel>()
  private typingListeners = new Map<string, Set<(userId: string) => void>>()

  constructor(url: string, anonKey: string) {
    this.db = makeClient(url, anonKey)
  }

  private async fetchProfile(id: string): Promise<Profile | null> {
    const { data, error } = await this.db
      .from('profiles')
      .select('id,username,display_name,about,color')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapProfile(data as ProfileRow) : null
  }

  private async requireUser(): Promise<Profile> {
    const me = await this.currentUser()
    if (!me) throw new Error('You are signed out. Please sign in again.')
    return me
  }

  async currentUser(): Promise<Profile | null> {
    const { data } = await this.db.auth.getSession()
    const sessionUser = data.session?.user
    if (!sessionUser) {
      this.cachedMe = null
      return null
    }
    if (this.cachedMe?.id === sessionUser.id) return this.cachedMe
    const profile = await this.fetchProfile(sessionUser.id)
    this.cachedMe = profile
    return profile
  }

  async signUp(input: AuthInput): Promise<Profile> {
    const usernameError = validateUsername(input.username)
    if (usernameError) throw new Error(usernameError)
    const passwordError = validatePassword(input.password)
    if (passwordError) throw new Error(passwordError)

    const username = normalizeUsername(input.username)
    if (await this.isUsernameTaken(username)) throw new Error('That username is already taken.')

    const { data, error } = await this.db.auth.signUp({
      email: emailFor(username),
      password: input.password,
      options: { data: { username, display_name: username } },
    })
    if (error) throw new Error(friendlyAuthError(error.message))

    if (!data.session) {
      throw new Error(
        'Account created, but this Supabase project still requires email confirmation. In Supabase open Authentication → Sign In / Providers → Email and turn off "Confirm email", then sign in.',
      )
    }

    const profile = await this.currentUser()
    if (!profile) {
      throw new Error(
        'Signed up, but no profile row was created. Run supabase/schema.sql in your project (it installs the profile trigger).',
      )
    }
    return profile
  }

  async signIn(input: AuthInput): Promise<Profile> {
    const username = normalizeUsername(input.username)
    const { error } = await this.db.auth.signInWithPassword({
      email: emailFor(username),
      password: input.password,
    })
    if (error) throw new Error(friendlyAuthError(error.message))

    const profile = await this.currentUser()
    if (!profile) throw new Error('Signed in, but your profile is missing. Check the Supabase schema.')
    return profile
  }

  async signOut(): Promise<void> {
    this.cachedMe = null
    for (const channel of this.typingChannels.values()) void this.db.removeChannel(channel)
    this.typingChannels.clear()
    this.typingListeners.clear()
    await this.db.auth.signOut()
  }

  async updateProfile(patch: ProfilePatch): Promise<Profile> {
    const me = await this.requireUser()
    const payload: Record<string, string> = {}
    if (patch.displayName !== undefined) {
      payload.display_name = patch.displayName.trim().slice(0, 40) || me.username
    }
    if (patch.about !== undefined) payload.about = patch.about.trim().slice(0, 140)
    if (patch.color !== undefined) payload.color = patch.color

    if (Object.keys(payload).length > 0) {
      const { error } = await this.db.from('profiles').update(payload).eq('id', me.id)
      if (error) throw new Error(error.message)
    }

    const updated = await this.fetchProfile(me.id)
    if (!updated) throw new Error('Could not reload your profile.')
    this.cachedMe = updated
    this.emit()
    return updated
  }

  async isUsernameTaken(username: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('profiles')
      .select('id')
      .eq('username', normalizeUsername(username))
      .limit(1)
    if (error) throw new Error(error.message)
    return (data ?? []).length > 0
  }

  async findProfile(username: string): Promise<Profile | null> {
    const { data, error } = await this.db
      .from('profiles')
      .select('id,username,display_name,about,color')
      .eq('username', normalizeUsername(username))
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapProfile(data as ProfileRow) : null
  }

  async listChats(): Promise<ChatSummary[]> {
    const me = await this.requireUser()

    const { data: mine, error: mineError } = await this.db
      .from('chat_members')
      .select('chat_id,last_read_at')
      .eq('user_id', me.id)
    if (mineError) throw new Error(mineError.message)

    const myRows = (mine ?? []) as { chat_id: string; last_read_at: string | null }[]
    const chatIds = myRows.map((row) => row.chat_id)
    if (chatIds.length === 0) return []

    const { data: members, error: membersError } = await this.db
      .from('chat_members')
      .select('chat_id,user_id,last_read_at,profiles(id,username,display_name,about,color)')
      .in('chat_id', chatIds)
    if (membersError) throw new Error(membersError.message)

    const { data: messages, error: messagesError } = await this.db
      .from('messages')
      .select('id,chat_id,sender_id,body,created_at')
      .in('chat_id', chatIds)
      .order('created_at', { ascending: false })
      .limit(400)
    if (messagesError) throw new Error(messagesError.message)

    const lastReadByMe = new Map(myRows.map((row) => [row.chat_id, row.last_read_at]))
    const peerByChat = new Map<string, Profile>()
    const peerReadByChat = new Map<string, string | null>()

    for (const row of (members ?? []) as MemberRow[]) {
      if (row.user_id === me.id) continue
      const embedded = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      if (embedded) peerByChat.set(row.chat_id, mapProfile(embedded))
      peerReadByChat.set(row.chat_id, row.last_read_at)
    }

    const lastByChat = new Map<string, Message>()
    const unreadByChat = new Map<string, number>()
    for (const row of (messages ?? []) as MessageRow[]) {
      if (!lastByChat.has(row.chat_id)) lastByChat.set(row.chat_id, mapMessage(row))
      if (row.sender_id === me.id) continue
      const lastRead = lastReadByMe.get(row.chat_id)
      if (!lastRead || new Date(row.created_at) > new Date(lastRead)) {
        unreadByChat.set(row.chat_id, (unreadByChat.get(row.chat_id) ?? 0) + 1)
      }
    }

    return chatIds
      .map<ChatSummary>((chatId) => {
        const lastMessage = lastByChat.get(chatId) ?? null
        const peer = peerByChat.get(chatId) ?? null
        return {
          id: chatId,
          // A self chat has no other member: show yourself as the peer.
          peer: peer ?? me,
          isSelf: peer === null,
          lastMessage,
          unread: unreadByChat.get(chatId) ?? 0,
          updatedAt: lastMessage?.createdAt ?? new Date(0).toISOString(),
          peerLastReadAt: peer ? peerReadByChat.get(chatId) ?? null : null,
        }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listMessages(chatId: string): Promise<Message[]> {
    const { data, error } = await this.db
      .from('messages')
      .select('id,chat_id,sender_id,body,created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(500)
    if (error) throw new Error(error.message)
    return ((data ?? []) as MessageRow[]).map(mapMessage)
  }

  async sendMessage(chatId: string, body: string): Promise<Message> {
    const me = await this.requireUser()
    const text = body.trim()
    if (!text) throw new Error('Write something first.')

    const { data, error } = await this.db
      .from('messages')
      .insert({ chat_id: chatId, sender_id: me.id, body: text.slice(0, 2000) })
      .select('id,chat_id,sender_id,body,created_at')
      .single()
    if (error) throw new Error(error.message)
    return mapMessage(data as MessageRow)
  }

  async startChatWith(username: string): Promise<string> {
    const peer = await this.findProfile(username)
    if (!peer) throw new Error(`No account found with the username @${normalizeUsername(username)}.`)

    const me = await this.requireUser()
    // Your own username opens the self chat instead of failing.
    if (peer.id === me.id) return this.startSelfChat()

    const { data, error } = await this.db.rpc('start_direct_chat', { p_peer: peer.id })
    if (error) throw new Error(error.message)
    const chatId = typeof data === 'string' ? data : null
    if (!chatId) throw new Error('Could not open that chat.')
    return chatId
  }

  async startSelfChat(): Promise<string> {
    const { data, error } = await this.db.rpc('start_self_chat')
    if (error) throw new Error(error.message)
    const chatId = typeof data === 'string' ? data : null
    if (!chatId) throw new Error('Could not open your self chat.')
    return chatId
  }

  async markRead(chatId: string): Promise<void> {
    const me = await this.requireUser()
    const { error } = await this.db
      .from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', chatId)
      .eq('user_id', me.id)
    if (error) throw new Error(error.message)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  private ensureChangeChannel() {
    if (this.changeChannel) return
    const channel = this.db.channel('chatter:changes')
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        this.emit()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, () => {
        this.emit()
      })
      .subscribe()
    this.changeChannel = channel
  }

  subscribeChanges(callback: () => void): () => void {
    this.listeners.add(callback)
    this.ensureChangeChannel()
    return () => {
      this.listeners.delete(callback)
      if (this.listeners.size === 0 && this.changeChannel) {
        void this.db.removeChannel(this.changeChannel)
        this.changeChannel = null
      }
    }
  }

  /** One long-lived broadcast channel per chat, created on first use. */
  private typingChannel(chatId: string) {
    const existing = this.typingChannels.get(chatId)
    if (existing) return existing

    const channel = this.db.channel(`chatter:typing:${chatId}`, {
      config: { broadcast: { self: false } },
    })
    channel.on('broadcast', { event: 'typing' }, () => {
      for (const callback of this.typingListeners.get(chatId) ?? []) callback('peer')
    })
    channel.subscribe()
    this.typingChannels.set(chatId, channel)
    return channel
  }

  sendTyping(chatId: string): void {
    const channel = this.typingChannel(chatId)
    void channel.send({ type: 'broadcast', event: 'typing', payload: { at: Date.now() } })
  }

  subscribeTyping(chatId: string, callback: (userId: string) => void): () => void {
    this.typingChannel(chatId)
    const listeners = this.typingListeners.get(chatId) ?? new Set<(userId: string) => void>()
    listeners.add(callback)
    this.typingListeners.set(chatId, listeners)
    return () => {
      listeners.delete(callback)
    }
  }
}

export function createSupabaseBackend(url: string, anonKey: string): ChatBackend {
  return new SupabaseBackend(url, anonKey)
}
