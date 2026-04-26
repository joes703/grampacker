const CHARS = 'abcdefghijklmnopqrstuvwxyz'

export function generateShareToken(): string {
  const arr = new Uint8Array(8)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => CHARS[b % CHARS.length]).join('')
}
