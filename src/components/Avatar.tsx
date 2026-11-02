import { initialsFor, type Profile } from '../lib/types'

export function Avatar({ profile, size = 44 }: { profile: Profile | null; size?: number }) {
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(11, Math.round(size * 0.36)),
    background: profile ? profile.color : '#2a3942',
    color: profile ? '#0b141a' : '#8696a0',
  }
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {profile ? initialsFor(profile) : '?'}
    </span>
  )
}
