export type Profile = {
  id: string
  username: string
  displayName: string
  about: string
  color: string
}

export type Message = {
  id: string
  chatId: string
  senderId: string
  body: string
  createdAt: string
}

export type ChatSummary = {
  id: string
  peer: Profile | null
  /** True for the "notes to yourself" chat, where `peer` is your own profile. */
  isSelf: boolean
  lastMessage: Message | null
  unread: number
  updatedAt: string
  /** When the other member of this chat last opened it (drives read ticks). */
  peerLastReadAt: string | null
}

export type ProfilePatch = {
  displayName?: string
  about?: string
  color?: string
}

export type AuthInput = {
  username: string
  password: string
}

export type BackendMode = 'supabase' | 'local'

export interface ChatBackend {
  readonly mode: BackendMode
  currentUser(): Promise<Profile | null>
  signUp(input: AuthInput): Promise<Profile>
  signIn(input: AuthInput): Promise<Profile>
  signOut(): Promise<void>
  updateProfile(patch: ProfilePatch): Promise<Profile>
  isUsernameTaken(username: string): Promise<boolean>
  findProfile(username: string): Promise<Profile | null>
  listChats(): Promise<ChatSummary[]>
  listMessages(chatId: string): Promise<Message[]>
  sendMessage(chatId: string, body: string): Promise<Message>
  /** Returns the id of the direct chat between the current user and `username`. */
  startChatWith(username: string): Promise<string>
  /** Opens (creating it once) the chat with yourself, for trying things out. */
  startSelfChat(): Promise<string>
  markRead(chatId: string): Promise<void>
  /** Fires whenever chats, messages or read receipts change. */
  subscribeChanges(callback: () => void): () => void
  sendTyping(chatId: string): void
  subscribeTyping(chatId: string, callback: (userId: string) => void): () => void
}

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw)
  if (!username) return 'Pick a username.'
  if (!USERNAME_PATTERN.test(username)) {
    return 'Use 3–20 characters: letters, numbers or underscore.'
  }
  return null
}

export function validatePassword(password: string): string | null {
  if (password.length < 6) return 'Password must be at least 6 characters.'
  return null
}

const PALETTE = [
  '#00a884',
  '#53bdeb',
  '#7f66ff',
  '#ff7a45',
  '#e67e22',
  '#9b59b6',
  '#2ecc71',
  '#eb5757',
  '#f2c94c',
  '#56ccf2',
]

export function colorFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

export function initialsFor(profile: Pick<Profile, 'username' | 'displayName'>): string {
  const source = profile.displayName.trim() || profile.username
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}
