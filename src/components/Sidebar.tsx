import { useState } from 'react'
import { formatListTime, truncate } from '../lib/format'
import { USERNAME_PATTERN, type BackendMode, type ChatSummary, type Profile } from '../lib/types'
import { Avatar } from './Avatar'
import { PlusIcon, QrIcon, ScanIcon, SearchIcon } from './Icons'

type Props = {
  me: Profile
  chats: ChatSummary[]
  activeId: string | null
  mode: BackendMode
  onSelect: (chatId: string) => void
  onStartChat: (username: string) => void
  onOpenSelfChat: () => void
  onOpenQr: (tab: 'show' | 'scan') => void
  onOpenProfile: () => void
}

export function Sidebar({
  me,
  chats,
  activeId,
  mode,
  onSelect,
  onStartChat,
  onOpenSelfChat,
  onOpenQr,
  onOpenProfile,
}: Props) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()

  const filtered = query
    ? chats.filter((chat) => {
        const peer = chat.peer
        if (!peer) return false
        return (
          peer.username.includes(query) ||
          peer.displayName.toLowerCase().includes(query) ||
          (chat.lastMessage?.body ?? '').toLowerCase().includes(query)
        )
      })
    : chats

  const canStartNew =
    USERNAME_PATTERN.test(query) && !chats.some((chat) => chat.peer?.username === query)

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <button className="sidebar__brand" type="button" onClick={onOpenProfile} title="Your profile">
          <Avatar profile={me} size={40} />
          <span className="sidebar__brand-text">
            <strong>{me.displayName}</strong>
            <span>@{me.username}</span>
          </span>
        </button>
        <div className="sidebar__actions">
          <button className="icon-btn" type="button" onClick={() => onOpenQr('show')} title="My QR code">
            <QrIcon />
          </button>
          <button className="icon-btn" type="button" onClick={() => onOpenQr('scan')} title="Scan a QR code">
            <ScanIcon />
          </button>
        </div>
      </header>

      <div className="search">
        <SearchIcon size={17} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search or type a username"
          aria-label="Search chats"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <div className="chat-list">
        {!query && !chats.some((chat) => chat.isSelf) && (
          <button className="chat-item" type="button" onClick={onOpenSelfChat}>
            <Avatar profile={me} />
            <span className="chat-item__body">
              <span className="chat-item__top">
                <span className="chat-item__name">Me</span>
              </span>
              <span className="chat-item__bottom">
                <span className="chat-item__preview">Chat with yourself to try it out</span>
              </span>
            </span>
          </button>
        )}

        {canStartNew && (
          <button className="chat-item" type="button" onClick={() => onStartChat(query)}>
            <span
              className="avatar"
              style={{ width: 44, height: 44, background: '#2a3942', color: '#00a884' }}
              aria-hidden="true"
            >
              <PlusIcon size={20} />
            </span>
            <span className="chat-item__body">
              <span className="chat-item__top">
                <span className="chat-item__name">Chat with @{query}</span>
              </span>
              <span className="chat-item__bottom">
                <span className="chat-item__preview">Start a new conversation</span>
              </span>
            </span>
          </button>
        )}

        {filtered.length > 0 && <div className="chat-list__section">Chats</div>}

        {filtered.map((chat) => {
          const last = chat.lastMessage
          const preview = last
            ? `${!chat.isSelf && last.senderId === me.id ? 'You: ' : ''}${truncate(last.body, 42)}`
            : chat.isSelf
              ? 'Notes to yourself'
              : 'Say hello 👋'
          return (
            <button
              key={chat.id}
              type="button"
              className={`chat-item${chat.id === activeId ? ' chat-item--active' : ''}`}
              onClick={() => onSelect(chat.id)}
            >
              <Avatar profile={chat.peer} />
              <span className="chat-item__body">
                <span className="chat-item__top">
                  <span className="chat-item__name">
                    {chat.isSelf ? 'You' : chat.peer?.displayName ?? 'Unknown user'}
                  </span>
                  {last && <span className="chat-item__time">{formatListTime(last.createdAt)}</span>}
                </span>
                <span className="chat-item__bottom">
                  <span className="chat-item__preview">{preview}</span>
                  {chat.unread > 0 && <span className="badge">{chat.unread > 99 ? '99+' : chat.unread}</span>}
                </span>
              </span>
            </button>
          )
        })}

        {filtered.length === 0 && !canStartNew && (
          <p className="chat-list__empty">
            {query
              ? `No chats match “${query}”. Type a full username (3+ characters) to start a new one.`
              : 'No chats yet. Share your QR code — or scan someone else’s — to open a conversation.'}
          </p>
        )}
      </div>

      {mode === 'local' && (
        <div className="demo-banner">
          Demo mode: accounts and messages stay in this browser. Add your Supabase keys to chat
          between devices.
        </div>
      )}
    </aside>
  )
}
