import { getSetting } from '../db/schema'

export type AudioMode = 'off' | 'tap' | 'auto'

export const getAudioMode = () => getSetting<AudioMode>('audioMode', 'tap')

function pickVoice(): SpeechSynthesisVoice | undefined {
  const vs = speechSynthesis.getVoices()
  return vs.find(v => v.lang.replace('_', '-') === 'it-IT') ?? vs.find(v => v.lang.toLowerCase().startsWith('it'))
}

function say(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'it-IT'
  const v = pickVoice()
  if (v) u.voice = v
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

/** Explicit user tap: plays unless mode is 'off'. */
export async function speak(text: string) {
  if ((await getAudioMode()) === 'off') return
  say(text)
}

/** For automatic flows: plays only when mode is 'auto'. */
export async function speakAuto(text: string) {
  if ((await getAudioMode()) === 'auto') say(text)
}
