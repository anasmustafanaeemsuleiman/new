import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { dayLabel, formatTime, sameDayIso } from '../lib/format'
import type { ChatSummary, Message, Profile } from '../lib/types'
import { Avatar } from './Avatar'
import {
  BackIcon,
  ChatIcon,
  CheckDoubleIcon,
  CheckIcon,
  QrIcon,
  ScanIcon,
  SendIcon,
} from './Icons'

type Props = {
  me: Profile
  chat: ChatSummary | null
  messages: Message[]
  typingLabel: string | null
  onSend: (text: string) => void
  onTyping: () => void
  onBack: () => void
  onOpenQr: (tab: 'show' | 'scan') => void
}

export function ChatPane({
  me,
  chat,
  messages,
  typingLabel,
  onSend,
  onTyping,
  onBack,
  onOpenQr,
}: Props) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft('')
  }, [chat?.id])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length, chat?.id, typingLabel])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    onSend(text)
  }

  if (!chat) {
    return (
      <main className="chat-pane">
        <div className="empty">
          <div className="empty__art">
            <ChatIcon size={40} />
          </div>
          <h2 className="empty__title">Chat without a phone number</h2>
          <p className="empty__text">
            Pick a chat on the left, or show your QR code and let someone scan it — the two of you
            are connected instantly.
          </p>
          <div className="empty__actions">
            <button className="btn btn--primary" type="button" onClick={() => onOpenQr('show')}>
              <QrIcon size={18} /> My QR code
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => onOpenQr('scan')}>
              <ScanIcon size={18} /> Scan a code
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="chat-pane">
      <header className="chat-pane__header">
        <button className="icon-btn" type="button" onClick={onBack} title="Back to chats">
          <BackIcon />
        </button>
        <Avatar profile={chat.peer} size={40} />
        <div className="chat-pane__peer">
          <div className="peer-name">
            {chat.isSelf ? 'You' : chat.peer?.displayName ?? 'Unknown user'}
          </div>
          <div className="peer-sub">
            {chat.isSelf
              ? 'Notes to self'
              : typingLabel ?? (chat.peer ? `@${chat.peer.username}` : '')}
          </div>
        </div>
        <button
          className="icon-btn"
          type="button"
          onClick={() => onOpenQr('show')}
          title="Share your QR code"
        >
          <QrIcon />
        </button>
      </header>

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="day-sep">
            {chat.isSelf
              ? 'This chat is just you — send something to try it out ✍️'
              : `No messages yet — say hi to ${chat.peer?.displayName ?? 'them'} 👋`}
          </div>
        )}

        {messages.map((message, index) => {
          const previous = messages[index - 1]
          const showDay = !previous || !sameDayIso(previous.createdAt, message.createdAt)
          const outgoing = message.senderId === me.id
          const read =
            !chat.isSelf && outgoing && chat.peerLastReadAt
              ? new Date(chat.peerLastReadAt).getTime() >= new Date(message.createdAt).getTime()
              : false

          return (
            <Fragment key={message.id}>
              {showDay && <div className="day-sep">{dayLabel(message.createdAt)}</div>}
              <div className={`msg-row${outgoing ? ' msg-row--out' : ''}`}>
                <div className="bubble">
                  <div className="bubble__text">{message.body}</div>
                  <div className="bubble__meta">
                    <span>{formatTime(message.createdAt)}</span>
                    {outgoing && (
                      <span className={`ticks${read ? ' ticks--read' : ''}`}>
                        {read ? <CheckDoubleIcon size={15} /> : <CheckIcon size={14} />}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Fragment>
          )
        })}
      </div>

      <div className="typing">{typingLabel ? 'typing…' : ''}</div>

      <form className="composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            onTyping()
          }}
          placeholder="Type a message"
          aria-label="Message"
          enterKeyHint="send"
          autoComplete="off"
        />
        <button className="composer__send" type="submit" disabled={!draft.trim()} title="Send">
          <SendIcon size={20} />
        </button>
      </form>
    </main>
  )
}
