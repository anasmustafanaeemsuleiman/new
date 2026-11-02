import { useState, type FormEvent } from 'react'
import type { ChatBackend, Profile } from '../lib/types'
import { LogoutIcon } from './Icons'
import { Modal } from './Modal'

type Props = {
  me: Profile
  backend: ChatBackend
  onClose: () => void
  onSaved: (profile: Profile) => void
  onSignOut: () => void
}

export function ProfileModal({ me, backend, onClose, onSaved, onSignOut }: Props) {
  const [displayName, setDisplayName] = useState(me.displayName)
  const [about, setAbout] = useState(me.about)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await backend.updateProfile({ displayName, about })
      onSaved(updated)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Your profile"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--primary" type="submit" form="profile-form" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button className="btn btn--ghost" type="button" onClick={onSignOut}>
            <LogoutIcon size={17} /> Sign out
          </button>
        </>
      }
    >
      <form id="profile-form" onSubmit={save} style={{ display: 'contents' }}>
        <div className="field">
          <label htmlFor="profile-username">Username (permanent)</label>
          <input id="profile-username" value={`@${me.username}`} disabled />
        </div>
        <div className="field">
          <label htmlFor="profile-name">Display name</label>
          <input
            id="profile-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={40}
            placeholder="How others see you"
          />
        </div>
        <div className="field">
          <label htmlFor="profile-about">About</label>
          <textarea
            id="profile-about"
            value={about}
            onChange={(event) => setAbout(event.target.value)}
            maxLength={140}
            rows={2}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <p className="hint">
          People reach you by username or by scanning the QR code on your profile.
        </p>
      </form>
    </Modal>
  )
}
