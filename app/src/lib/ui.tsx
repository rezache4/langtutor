import { useState } from 'react'
import { speak } from './tts'
import { useAudioMode } from './settings'

export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const CLAMP_LEN = 140

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

/** Sentence line clamped to 3 lines when longer than ~140 chars, with a 'more' tap to expand. */
export function ExLine({ text, form, className }: { text: string; form: string; className?: string }) {
  const [exp, setExp] = useState(false)
  const [prev, setPrev] = useState(text)
  if (text !== prev) { setPrev(text); setExp(false) }
  const clamped = text.length > CLAMP_LEN && !exp
  return (
    <div className={className}>
      <span className={clamped ? 'clamp3' : undefined} onClick={clamped ? () => setExp(true) : undefined}>
        <Highlighted text={text} form={form} />
        {!clamped && <> <Speak text={text} /></>}
      </span>
      {clamped && (
        <span className="clamp-more">
          <button type="button" className="link" onClick={() => setExp(true)}>more</button> <Speak text={text} />
        </span>
      )}
    </div>
  )
}
