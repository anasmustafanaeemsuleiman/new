import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthScreen } from './components/AuthScreen'
import { ChatPane } from './components/ChatPane'
import { ProfileModal } from './components/ProfileModal'
import { QrModal } from './components/QrModal'
import { Sidebar } from './components/Sidebar'
import { getBackend } from './lib/backend'
import { parseDeepLink } from './lib/qr'
import type { ChatSummary, Message, Profile } from './lib/types'

const errorMessage = (caught: unknown): string =>
  caught instanceof Error ? caught.message : 'Something went wrong.'

export default function App() {
  const backend = useMemo(() => getBackend(), [])

  const [me, setMe] = useState<Profile | null>(null)
  const [booting, setBooting] = useState(true)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [version, setVersion] = useState(0)
  const [typingAt, setTypingAt] = useState(0)
  const [qrTab, setQrTab] = useState<'show' | 'scan' | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingUsername, setPendingUsername] = useState<string | null>(() =>
    parseDeepLink(window.location.hash),
  )

  const activeRef = useRef<string | null>(null)
  activeRef.current = activeId
  const markedRef = useRef<Record<string, string>>({})
  const typingSentRef = useRef(0)

  // Restore an existing session on load.
  useEffect(() => {
    let alive = true
    backend
      .currentUser()
      .then((user) => {
        if (alive) setMe(user)
      })
      .catch(() => {
        if (alive) setNotice('Could not restore your session — please sign in again.')
      })
      .finally(() => {
        if (alive) setBooting(false)
      })
    return () => {
      alive = false
    }
  }, [backend])

  // Realtime: any change in chats/messages/read receipts bumps the version.
  useEffect(() => {
    if (!me) return
    return backend.subscribeChanges(() => setVersion((value) => value + 1))
  }, [me, backend])

  // Chat list.
  useEffect(() => {
    if (!me) {
      setChats([])
      return
    }
    let alive = true
    backend
      .listChats()
      .then((list) => {
        if (!alive) return
        setChats(
          list.map((chat) => (chat.id === activeRef.current ? { ...chat, unread: 0 } : chat)),
        )
      })
      .catch((caught) => {
        if (alive) setNotice(errorMessage(caught))
      })
    return () => {
      alive = false
    }
  }, [me, version, backend])

  // Messages of the open chat (+ mark it read once per new last message).
  useEffect(() => {
    if (!me || !activeId) {
      setMessages([])
      return
    }
    const chatId = activeId
    let alive = true
    backend
      .listMessages(chatId)
      .then((list) => {
        if (!alive || activeRef.current !== chatId) return
        setMessages(list)
        const last = list[list.length - 1]
        if (last && markedRef.current[chatId] !== last.id) {
          markedRef.current[chatId] = last.id
          setChats((previous) =>
            previous.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
          )
          backend.markRead(chatId).catch(() => undefined)
        }
      })
      .catch((caught) => {
        if (alive) setNotice(errorMessage(caught))
      })
    return () => {
      alive = false
    }
  }, [me, activeId, version, backend])

  // Typing indicators for the open chat.
  useEffect(() => {
    if (!me || !activeId) return
    return backend.subscribeTyping(activeId, () => setTypingAt(Date.now()))
  }, [me, activeId, backend])

  useEffect(() => {
    if (!typingAt) return
    const timer = window.setTimeout(() => setTypingAt(0), 4000)
    return () => window.clearTimeout(timer)
  }, [typingAt])

  // Auto-hide toasts.
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const startChat = useCallback(
    async (username: string) => {
      try {
        const chatId = await backend.startChatWith(username)
        setActiveId(chatId)
        setQrTab(null)
        setVersion((value) => value + 1)
      } catch (caught) {
        setNotice(errorMessage(caught))
      }
    },
    [backend],
  )

  const handleScan = useCallback(
    (username: string) => {
      void startChat(username)
    },
    [startChat],
  )

  const openSelfChat = useCallback(async () => {
    try {
      const chatId = await backend.startSelfChat()
      setActiveId(chatId)
      setVersion((value) => value + 1)
    } catch (caught) {
      setNotice(errorMessage(caught))
    }
  }, [backend])

  // QR deep link (#/u/username): open that chat as soon as we are signed in.
  useEffect(() => {
    if (!me || !pendingUsername) return
    let alive = true
    backend
      .startChatWith(pendingUsername)
      .then((chatId) => {
        if (!alive) return
        setActiveId(chatId)
        setVersion((value) => value + 1)
        setPendingUsername(null)
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      })
      .catch((caught) => {
        if (!alive) return
        setNotice(errorMessage(caught))
        setPendingUsername(null)
      })
    return () => {
      alive = false
    }
  }, [me, pendingUsername, backend])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!activeId) return
      try {
        const message = await backend.sendMessage(activeId, text)
        setMessages((previous) =>
          previous.some((candidate) => candidate.id === message.id)
            ? previous
            : [...previous, message],
        )
        // A new message ends the typing burst; the next keystroke should signal
        // "typing" immediately instead of waiting out the throttle window.
        typingSentRef.current = 0
        setVersion((value) => value + 1)
      } catch (caught) {
        setNotice(errorMessage(caught))
      }
    },
    [activeId, backend],
  )

  const notifyTyping = useCallback(() => {
    if (!activeId) return
    const now = Date.now()
    if (now - typingSentRef.current < 2000) return
    typingSentRef.current = now
    backend.sendTyping(activeId)
  }, [activeId, backend])

  const signOut = useCallback(async () => {
    try {
      await backend.signOut()
    } catch {
      /* ignore — we clear local state either way */
    }
    setMe(null)
    setChats([])
    setMessages([])
    setActiveId(null)
    setProfileOpen(false)
    setQrTab(null)
    markedRef.current = {}
  }, [backend])

  if (booting) {
    return (
      <div className="splash">
        <div className="spinner" />
        <span>Loading Chatter…</span>
      </div>
    )
  }

  if (!me) {
    return (
      <>
        <AuthScreen
          backend={backend}
          onAuth={(profile) => {
            setMe(profile)
            setVersion((value) => value + 1)
          }}
        />
        {notice && <div className="toast">{notice}</div>}
      </>
    )
  }

  const activeChat = chats.find((chat) => chat.id === activeId) ?? null
  const typingLabel =
    typingAt && activeChat?.peer && !activeChat.isSelf
      ? `${activeChat.peer.displayName} is typing…`
      : null

  return (
    <>
      <div className="app" data-view={activeId ? 'chat' : 'list'}>
        <Sidebar
          me={me}
          chats={chats}
          activeId={activeId}
          mode={backend.mode}
          onSelect={(chatId) => {
            setActiveId(chatId)
            setMessages([])
            setTypingAt(0)
          }}
          onStartChat={(username) => void startChat(username)}
          onOpenSelfChat={() => void openSelfChat()}
          onOpenQr={(tab) => setQrTab(tab)}
          onOpenProfile={() => setProfileOpen(true)}
        />

        <ChatPane
          me={me}
          chat={activeChat}
          messages={messages}
          typingLabel={typingLabel}
          onSend={(text) => void sendMessage(text)}
          onTyping={notifyTyping}
          onBack={() => {
            setActiveId(null)
            setMessages([])
          }}
          onOpenQr={(tab) => setQrTab(tab)}
        />
      </div>

      {qrTab && (
        <QrModal
          me={me}
          initialTab={qrTab}
          onClose={() => setQrTab(null)}
          onScanned={handleScan}
        />
      )}

      {profileOpen && (
        <ProfileModal
          me={me}
          backend={backend}
          onClose={() => setProfileOpen(false)}
          onSaved={(profile) => setMe(profile)}
          onSignOut={() => void signOut()}
        />
      )}

      {notice && <div className="toast">{notice}</div>}
    </>
  )
}
