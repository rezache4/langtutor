import { speak } from './tts'
import { useAudioMode } from './settings'

export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function Highlighted({ text, form }: { text: string; form: string }) {
  if (!form) return <>{text}</>
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${esc(form)})(?![\\p{L}\\p{N}])`, 'iu')
  const m = re.exec(text)
  if (!m) return <>{text}</>
  return <>{text.slice(0, m.index)}<mark>{m[1]}</mark>{text.slice(m.index + m[1].length)}</>
}

const hasTTS = typeof window !== 'undefined' && 'speechSynthesis' in window

/** Speaker button: hidden when audio is off or unsupported. */
export function Speak({ text }: { text: string }) {
  const mode = useAudioMode()
  if (!hasTTS || mode === 'off') return null
  return <button className="icon" onClick={() => speak(text)} aria-label="Play audio">🔊</button>
}
