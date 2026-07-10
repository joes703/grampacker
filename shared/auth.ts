// Minimum password length. The server enforces it via better-auth
// (emailAndPassword.minPasswordLength in server/auth.ts); every client
// password form mirrors it so the UX matches the real gate. Single source
// of truth - bump here and both sides move together. Existing shorter
// passwords keep working for sign-in; the minimum only applies when a
// password is set or changed.
export const MIN_PASSWORD_LENGTH = 12
