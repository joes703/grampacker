// AAGUID -> passkey provider names, for provenance labels in the passkey
// settings UI ("1Password", "Google Password Manager", ...). Copied from
// @better-auth/passkey's commonAuthenticatorNames (v1.6.23), which mirrors
// the community-maintained registry verbatim:
//
//   https://github.com/passkeydeveloper/passkey-authenticator-aaguids
//
// The plugin exports its lookup only from the server entry point; importing
// that into the SPA would drag @simplewebauthn/server into the bundle, so
// the map lives here as a small local copy.
//
// Coverage caveat (documented upstream too): Apple devices zero the AAGUID
// under the default attestation:"none" flow, so Apple/iCloud passkeys
// usually resolve to undefined and fall back to the generic label. The
// Apple entries below only appear in attested or managed contexts.
const AUTHENTICATOR_NAMES: Record<string, string> = {
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'Apple Passwords',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain (Managed)',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
  'b78a0a55-6ef8-d246-a042-ba0f6d55050c': 'LastPass',
  'b84e4048-15dc-4dd0-8640-f4f60813c8af': 'NordPass',
  '50726f74-6f6e-5061-7373-50726f746f6e': 'Proton Pass',
  '0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6': 'Keeper',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
}

// Privacy-preserving platforms report this instead of a real AAGUID.
const ANONYMOUS_AAGUID = '00000000-0000-0000-0000-000000000000'

export function authenticatorName(
  aaguid: string | null | undefined,
): string | undefined {
  const normalized = aaguid?.trim().toLowerCase()
  if (!normalized || normalized === ANONYMOUS_AAGUID) return undefined
  return AUTHENTICATOR_NAMES[normalized]
}
