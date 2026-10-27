// The auth-client stub for page tests that need a signed-in session and
// nothing else from better-auth. Use from a dynamic import, because vi.mock
// factories are hoisted above the file's static imports:
//   vi.mock('../lib/auth-client', async () =>
//     (await import('../test/auth-client-mock')).signedInAuthClient)
export const signedInAuthClient = {
  authClient: { useSession: () => ({ data: { user: { id: 'owner-1' } }, isPending: false }) },
}
