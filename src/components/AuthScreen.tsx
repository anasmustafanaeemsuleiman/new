import { useState, type FormEvent } from 'react'
import { normalizeUsername, type ChatBackend, type Profile } from '../lib/types'
import { ChatIcon } from './Icons'

type Props = {
  backend: ChatBackend
  onAuth: (profile: Profile) => void
}

export function AuthScreen({ backend, onAuth }: Props) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const credentials = { username: normalizeUsername(username), password }
      const profile =
        mode === 'in' ? await backend.signIn(credentials) : await backend.signUp(credentials)
      onAuth(profile)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const isLocal = backend.mode === 'local'

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__logo">
          <div className="auth__logo-mark">
            <ChatIcon size={24} />
          </div>
          <div>
            <h1 className="auth__title">Chatter</h1>
            <p className="auth__sub">Chat with anyone — no phone number needed</p>
          </div>
        </div>

        <span className={`mode-pill ${isLocal ? 'mode-pill--local' : 'mode-pill--live'}`}>
          {isLocal ? 'Demo mode · browser only' : 'Live · connected to Supabase'}
        </span>

        <div className="auth__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'in'}
            onClick={() => {
              setMode('in')
              setError(null)
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'up'}
            onClick={() => {
              setMode('up')
              setError(null)
            }}
          >
            Create account
          </button>
        </div>

        <form className="auth__form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="auth-username">Username</label>
            <input
              id="auth-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. alex_92"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create my account'}
          </button>
        </form>

        <p className="auth__note">
          Your username is how people find you. Once you are in, share your QR code so someone can
          open a chat with you instantly.
          {isLocal && (
            <>
              {' '}
              In demo mode accounts stay in this browser — open a second tab (or a private window)
              to sign in as a second person and try a conversation.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
