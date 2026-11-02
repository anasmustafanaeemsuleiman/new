import { createLocalBackend } from './localBackend'
import { createSupabaseBackend } from './supabaseBackend'
import type { ChatBackend } from './types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(url && anonKey)

let instance: ChatBackend | null = null

/**
 * One backend for the whole app: a real Supabase project when the two env
 * vars are present, otherwise a browser-local backend so the app is usable
 * (and testable) before any keys exist.
 */
export function getBackend(): ChatBackend {
  if (!instance) {
    instance = isSupabaseConfigured
      ? createSupabaseBackend(url as string, anonKey as string)
      : createLocalBackend()
  }
  return instance
}
