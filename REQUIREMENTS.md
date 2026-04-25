# grampacker — Product Requirements

A gear-weight tracking application for hikers and backpackers. Users maintain a personal inventory of gear items and build trip-specific packing lists from that inventory. The primary concern of the application is weight — everything is measured, categorized, and summarized by weight.

---

## Data Model

### User

- `id` — unique identifier
- `username` — 3–64 characters, alphanumeric and underscores only; case-insensitive for lookup and conflict detection; stored as entered
- `email` — optional; must be a valid email if provided; unique (case-insensitive)
- `password_hash` — bcrypt hash; never stored or returned in plaintext
- `session_version` — integer, incremented on password change or reset; used to invalidate all existing sessions
- `password_reset_token` — SHA-256 hex of a one-time URL-safe token; nullable
- `password_reset_expires` — UTC timestamp; token expires 1 hour after issue
- `last_active_at` — updated on every authenticated request
- `created_at`, `updated_at`

### Category

Categories are labels that organize gear items. They belong to a single user.

- `id`
- `user_id` — owner; cascade-deleted when user is deleted
- `name` — up to 128 characters
- `sort_order` — integer; categories are ordered by sort_order ascending, then by name
- `is_default` — boolean; marks the seven categories created automatically at registration
- `created_at`

**Default categories** created for every new user: Pack, Shelter, Sleep, Kitchen, Water, Clothing, Hygiene (in that order, with sort_order 0–6).

When a category is deleted, its gear items are **not** deleted; their `category_id` is set to null (they become "uncategorised").

### GearItem

The gear library — a user's personal inventory of all their gear.

- `id`
- `user_id` — owner; cascade-deleted when user is deleted
- `category_id` — nullable foreign key to categories; set to null when category is deleted
- `name` — up to 256 characters; required
- `description` — optional text, up to 2000 characters
- `weight_grams` — integer grams, 0–100,000; required; default 0
- `sort_order` — integer; items ordered by sort_order then name
- `created_at`, `updated_at`

### List

A trip-specific packing list.

- `id`
- `user_id` — owner; cascade-deleted when user is deleted
- `name` — up to 256 characters; required
- `description` — optional text, up to 2000 characters
- `share_token` — 8-character URL-safe alphanumeric string, globally unique; generated at creation and never null
- `is_shared` — boolean; controls whether the public share link is active; default false
- `sort_order` — integer; lists ordered by sort_order ascending, then by updated_at descending
- `created_at`, `updated_at`

### ListItem

A gear item added to a specific list. Acts as the join between List and GearItem but carries its own state.

- `id`
- `list_id` — cascade-deleted when list is deleted
- `gear_item_id` — cascade-deleted when the gear item is deleted (removing the item from all lists)
- `quantity` — integer ≥ 1; default 1
- `weight_grams` — **snapshot** of the gear item's weight at the time the item was added to the list; updated only when the user explicitly edits the weight on the list or syncs from inventory; decoupled from the gear library so inventory changes do not silently change list weights
- `is_worn` — boolean; mutually exclusive with `is_consumable`
- `is_consumable` — boolean; mutually exclusive with `is_worn`
- `is_packed` — boolean; packing-mode checkbox state; excluded from public share responses
- `sort_order` — integer; items ordered by sort_order then id within each list
- `created_at`, `updated_at`

---

## Weight Categorization

Every item in a list has one of three weight classifications based on its flags:

- **Base** — `is_worn = false` and `is_consumable = false`
- **Worn** — `is_worn = true`
- **Consumable** — `is_consumable = false` and `is_consumable = true`

The flags are mutually exclusive. The API rejects any request that attempts to set both to true. When both arrive in import data, worn takes priority.

**Weight rollups:**

- **Base Weight** — sum of `weight_grams × quantity` for all base items (not worn, not consumable)
- **Consumable Weight** — sum for consumable items
- **Pack Weight** — Base Weight + Consumable Weight (what goes in/on the pack; worn items excluded)
- **Worn Weight** — sum for worn items
- **Total Weight** — Base Weight + Consumable Weight + Worn Weight (everything)

The list index and list detail both expose `base_weight_grams` and `total_weight_grams` as pre-computed rollups.

**Weight display** uses two modes toggled globally per session (persisted in `localStorage` under key `"weightUnit"`):

- Grams mode: `"1035 g"`
- Imperial mode for individual item weights: `"36.5 oz"` (oz only, never the compound form)
- Imperial mode for summary/total weights: `"9.2 oz"` under 1 lb; `"2 lb 5.4 oz"` at 1 lb or more

The weight table always shows both grams and lb+oz columns simultaneously regardless of the display mode.

Conversion factor: 1 g = 0.035274 oz exactly (as used throughout).

---

## User Authentication

### Registration

- Required: username (3–64 chars, `[a-zA-Z0-9_]` only), password (8–128 chars)
- Optional: email address
- Username uniqueness is checked case-insensitively
- If the email is already registered, the error message is deliberately vague ("registration could not be completed") to avoid disclosing whether the address exists
- After registration, the user is logged in immediately
- Seven default categories are created for the new user

### Login

- Accepts username (case-insensitive) and password
- Constant-time password comparison — a dummy bcrypt hash is compared even when the username does not exist, so timing cannot reveal whether a username is registered
- Per-username lockout: after 5 failed attempts within a 5-minute sliding window, further attempts are blocked for 30 seconds
- Successful login clears any outstanding password reset token
- Sessions last 30 days

### Session Invalidation

- `session_version` is stored in the session cookie and checked on every authenticated request against the database value
- Changing or resetting the password increments `session_version`, immediately invalidating all other active sessions

### Password Reset

- User submits their username
- The endpoint always returns HTTP 200 regardless of whether the username exists or has an email, to prevent enumeration
- If a valid email is found, a one-time reset link is emailed (valid 1 hour)
- The link contains a raw URL-safe token; only a SHA-256 hash of the token is stored in the database
- After reset, the user is logged in automatically
- The response on this route carries `Referrer-Policy: no-referrer` to prevent the token leaking in HTTP Referer headers

### Change Password

- Requires the current password and matching new password (8–128 chars)
- Increments `session_version` (invalidates other sessions) but keeps the current session active

---

## Categories

- Listed in sort_order + name order
- Can be created, renamed, and reordered
- Deleting a category uncategorises its gear items (does not delete them)
- The `is_default` flag is informational only — default categories can be renamed or deleted the same as custom ones

---

## Gear Library

The gear library is the user's master inventory. It is independent of any specific list — items in the library exist regardless of whether they appear on any list.

**Listing and search:**

- Returns all items ordered by sort_order, then name
- Optional case-insensitive substring search on name (used for autocomplete)
- Items are grouped by category in the UI; uncategorised items appear in an "Uncategorised" group

**Creating items:**

- Name, optional description, weight in grams, optional category
- Weight defaults to 0 if not supplied
- Per-user cap: 500 gear items

**Editing items:**

- Any combination of name, description, weight, category can be patched in a single request
- Setting `category_id` to null uncategorises the item
- The UI supports inline editing of name and description directly in the row (click to edit, Enter/blur saves, Escape cancels)
- A separate full-form dialog is also available for editing all fields

**Deleting items:**

- Hard delete; removes the item from all lists it appears on (via cascade)
- Single delete: confirmation dialog warns that the item will be removed from all lists
- Bulk delete available in "select mode": select individual items, then delete all selected at once

**Bulk operations (select mode):**

- Toggle select mode via a "Select" button; exits on Cancel
- Select/deselect individual items or use "Select all" / "Deselect all"
- Bulk delete: confirmation shows count
- Bulk move to category: dialog with category picker (including "— Uncategorised —")
- A fixed toolbar appears at the bottom of the viewport when items are selected

**Category drag-and-drop reordering:**

- Category headers in the gear library are draggable (grip handle on the left of each header)
- Dropping a category header reorders all categories; changes are persisted immediately

**Exports:**

- Export the entire gear library as a LighterPack-compatible CSV (see CSV Format below)

**Imports:**

- Import a CSV file to add items to the gear library (no list is created)
- Rate-limited to 10 imports per hour per user
- File must be UTF-8, max 2 MB

---

## Lists

### List Index

- Lists are shown as cards in a 2-column grid, ordered by sort_order (ascending) then updated_at (descending)
- Each card shows: name, description (up to 2 lines), last-updated date, and an action strip with Pack, Public/Share, Copy Link, and a three-dot menu (Rename, Duplicate, Export, Delete)
- Cards are draggable to reorder (grip handle); reorder is persisted immediately

### Creating a List

- Required: name. Optional: description
- On creation, navigates directly to the new list's detail page
- Per-user cap: 100 lists

### List Detail

The main editing view for a single list.

**Layout:**

- On desktop: a collapsible gear library panel on the left (≥lg breakpoint), list content on the right. Panel collapse state is persisted in `localStorage`
- On mobile: the library panel is hidden; a "Add item" button within each category group opens a bottom sheet showing the gear library

**List header:**

- Back button, list name, rename button (pencil icon)
- Rename via dialog (Enter submits, existing name pre-filled)

**Action bar:**

- Pack button — navigates to packing mode
- Public button — toggles sharing on/off (blue when active)
- Copy Link button — copies share URL to clipboard (only visible when sharing is on)
- New item button — opens the new-item dialog
- Export button — downloads a CSV of this list

**Description:**

- Auto-saving textarea; saves on blur or when focus leaves. Escape reverts the value without saving

**Weight table:**

- Appears beside the description on desktop; stacks below on mobile
- Rows per category showing base weight only (worn and consumable excluded from category subtotals)
- Summary rows: Base Weight (bold), Consumables (if any), Pack Weight (bold), Worn Weight (if any, with gap)
- Always shows grams + lb + oz columns simultaneously

**Items:**

- Items are grouped by category; each category is a collapsible section
- Within a category, items are draggable to reorder (grip handle on the left); reordering is constrained within the same category — you cannot drag an item into a different category's section
- Sort order is persisted immediately after drag

**Item row controls:**

- Worn flag toggle (icon button)
- Consumable flag toggle (icon button); toggling one flag clears the other
- Quantity stepper (up/down chevrons) and inline quantity edit (click the `×N` text to type a value directly; Enter/blur saves, Escape cancels)
- Inline weight edit (click weight text to enter grams; Enter/blur saves, Escape cancels)
- Delete button (trash icon)

**Weight out-of-sync indicator:**

- If the list item's snapshot weight differs from the current inventory weight, the weight is shown in amber
- While the weight field is being edited, an amber refresh icon appears that, when clicked, pulls the inventory weight into the snapshot
- After any inline weight save, a dialog asks whether to push the new weight back to the gear inventory as well

### Adding Items to a List

There are two flows for adding items:

**From the library (library panel or mobile bottom sheet):**

- Gear is shown grouped by category with a search box (debounced 250ms on mobile sheet, 0ms delay for desktop panel initial load)
- Items already in the list show a checkmark; if quantity > 1, the count is shown
- Clicking an item that is **not** in the list adds it with quantity 1
- Clicking an item **already** in the list increments its quantity by 1
- The sheet stays open after an add so multiple items can be added sequentially

**New item dialog:**

- Creates a new gear item AND adds it to the list in one step
- Fields: name (required), weight in grams (default 0), category (optional dropdown)
- The new item is created in the gear library and appears immediately in the library panel

### Cloning a List

- Creates a new list named "Copy of {original name}" (truncated to 256 chars)
- Copies all items with their weights, quantities, worn/consumable flags, and sort orders
- `is_packed` is reset to false on all cloned items
- Navigates to the clone immediately

### Sharing

- Each list has a persistent 8-character alphanumeric `share_token` generated at creation
- `is_shared` toggles whether the token is active; toggling is a single action (the same button enables and disables)
- When sharing is off, `share_token` is not surfaced in API responses (remains in the database)
- The share URL pattern is `/r/{token}`
- A "regenerate token" action replaces the token (breaking the old link); retries up to 5 times on the rare collision
- The API returns 404 for both unknown tokens and inactive shared lists (to prevent enumeration)

---

## Packing Mode

A dedicated checklist view for physically packing gear.

- Accessed via `/lists/:id/pack`
- Items grouped by category; each category is collapsible with a "X / Y packed" count
- Tapping any item toggles its `is_packed` state (persisted immediately)
- A progress bar at the top shows overall packed count and percentage
- `is_packed` state is personal and stripped from the public share view

---

## Public Share View

Accessible at `/r/:token` without authentication.

- Returns 404 if token not found or `is_shared` is false
- Shows: list name, description, weight table, items grouped by category
- Item fields visible: name, description, weight, quantity, is_worn, is_consumable, sort_order, category name
- Fields deliberately excluded: is_packed, internal IDs (list_item id, gear_item id), share_token, user identity
- Category data comes from the list owner's categories, filtered to only include categories actually present on this list, ordered by sort_order
- The weight table on the public view uses the live gear item weight (`weight_grams` from the share response), not the snapshot; the share endpoint reads `gi.weight_grams` directly rather than `li.weight_grams`
- A unit toggle button (g / oz) is available on the public view, using the same localStorage preference key as the authenticated app
- Rate-limited to 60 requests per minute

---

## CSV Format

The format is designed to be compatible with LighterPack.

### Column layout (0-indexed)

| Index | Column name | Notes |
|-------|-------------|-------|
| 0 | Item Name | required |
| 1 | Category | category name string |
| 2 | desc | description / notes |
| 3 | qty | quantity (integer) |
| 4 | weight | numeric |
| 5 | unit | `g`, `oz`, or `lb` |
| 6 | worn | `1` or `0` |
| 7 | consumable | `1` or `0` |
| 8 | Image URL | exported as empty string; ignored on import |

### Export

- Header row is always written first
- Weights are always exported in grams (unit column = `"g"`)
- Per-item quantity from the list is exported in the qty column
- worn and consumable columns reflect the list item flags
- The gear library export uses qty = 1, worn = 0, consumable = 0 for every row
- Filenames are sanitised: alphanumeric, space, hyphen, and underscore characters pass through; everything else becomes `_`
- Cell values starting with `=`, `+`, `-`, or `@` are prefixed with a single quote to prevent spreadsheet formula injection
- File encoding: UTF-8

### Import into a list

- Accepted as multipart/form-data with field name `file`; optional `list_name` field overrides the list name (defaults to the filename without extension, or "Imported List" if that is empty)
- Max file size: 2 MB; must be UTF-8 (BOM-stripped)
- Header detection: if the first cell of row 0 (lowercased) is `"item name"` or `"name"`, the row is skipped as a header
- Rows with an empty name are skipped (counted as `skipped_rows` in the response)
- Any row that fails to parse is skipped; the import continues
- Weight conversion on import: oz → multiply by 28.3495; lb → multiply by 453.592; result rounded to integer grams; clamped to 100,000 g
- Quantity defaults to 1 if the qty cell is missing or non-integer
- If both worn and consumable are set to 1, worn wins (consumable is cleared)
- Categories are looked up case-insensitively and created if not found
- Gear items are looked up by name + category (case-insensitive); an existing match is reused (weight and description of existing items are not updated); a new item is created if no match
- The response includes the full list with items (same shape as GET /lists/:id) plus a `skipped_rows` count
- Per-user caps are checked before import: must be under 100 lists, under 300 items per list, and the gear item count plus row count must not exceed 500

### Import into gear library only

- Same file format and size limits as list import
- No list is created; each row creates a new gear item (no deduplication — unlike the list import, this always creates new items)
- Returns `{ imported, skipped_rows }`
- Rate-limited: 10 imports per hour

---

## Account Management

### Change Password

- Requires current password, new password, confirmation
- New password must match confirmation, be 8–128 chars
- Invalidates all other sessions (increments session_version) but keeps the current one active
- Rate-limited: 5 requests per hour per user

### Download My Data

- Returns a zip file named `grampacker-export.zip` containing:
  - `inventory.csv` — the full gear library in LighterPack CSV format
  - One CSV per list, named `list-{sanitised-name}.csv`; if two lists produce the same sanitised name, subsequent files get a numeric suffix (`list-name-1.csv`, etc.)
  - `account.json` — `{ username, created_at }`
- Rate-limited: 10 exports per hour per user

### Delete Account

- Requires typing the username exactly (case-insensitive comparison) in a confirmation dialog
- Hard-deletes all data: list items, lists, gear items, categories, then the user record
- Logs the user out and redirects to the register page with a confirmation message
- Rate-limited: 3 requests per hour per user

---

## Resource Limits

- 100 lists per user
- 300 list items per list
- 500 gear items per user
- Max single item weight: 100,000 g (100 kg)
- Max name length: 256 characters (gear items, lists); 128 characters (categories)
- Max description length: 2,000 characters
- Max CSV upload: 2 MB

---

## Rate Limits

- Registration: 5 per hour per IP
- Login: 10 per hour per IP
- Forgot password: 5 per hour per IP
- Reset password: 10 per hour per IP
- CSV import (list or gear): 10 per hour per user (falls back to IP for unauthenticated)
- Data export: 10 per hour per user
- Change password: 5 per hour per user
- Account deletion: 3 per hour per user
- Public share view: 60 per minute per IP

---

## Non-Obvious Behaviors and Edge Cases

**Inventory weight vs. list snapshot weight.** When a gear item is added to a list, the item's current weight is snapshotted into `list_items.weight_grams`. Subsequent changes to the inventory weight do not affect any list. The list detail view surfaces both values: `weight_grams` (the snapshot) and `inventory_weight_grams` (the current library value). When they differ, the weight display turns amber. The user can resolve the discrepancy in two ways: edit the list weight to a new value (and optionally push it back to the library), or click the sync icon to pull the current library weight into the list snapshot.

**Adding an item already in the list from the library browser** increments its quantity instead of creating a duplicate row.

**Items are deleted from all lists when deleted from the library.** The cascade on the foreign key means a single gear item delete removes it from every list it appears on. The UI warns about this.

**Drag-and-drop reordering in the list detail is category-scoped.** You can only drag items within the same category section; dragging across category sections is blocked. To move an item to a different category, you edit the underlying gear item's category in the library.

**Category deletion in the gear library.** Deleting a category does not delete the gear items inside it; they become uncategorised. This applies regardless of whether those items are on any lists.

**Clone resets packing state.** When cloning a list, all `is_packed` flags are reset to false. All other item state (weight snapshot, quantity, worn, consumable, sort order) is preserved.

**Share token is always present but conditionally revealed.** The token is generated at list creation and never null, but it is only included in API responses when `is_shared = true`. Disabling sharing hides the token from responses but does not change it.

**Regenerate token vs. toggle sharing.** These are separate actions. Regenerating creates a new token and breaks any existing share links regardless of whether sharing is currently on.

**Category ordering in the public share view.** The public share endpoint fetches only the categories that have at least one item in the list, ordered by their sort_order. It does not expose all of the owner's categories.

**Internal IDs are not exposed in the public share response.** list_item id and gear_item id are omitted to prevent enumeration of internal resources.

**CSV import deduplication.** During a list import, gear items are matched by name + category (case-insensitive). If a match exists, that item is reused; its weight and description are not updated. During a gear library import, no deduplication occurs — every valid row creates a new item.

**Import conflict when both worn and consumable are set.** Worn takes priority; consumable is silently cleared.

**Session version check.** On every authenticated request, the session's stored `session_version` is compared against the database value. A mismatch (caused by a password change or reset on another device) logs the user out immediately.

**Constant-time login.** A dummy bcrypt hash is compared even when the username does not exist, so response timing is identical for "username not found" and "wrong password" cases.

**Forgot-password endpoint is always 200.** The response does not reveal whether the username exists, whether it has an email, or whether the email was sent successfully.

**`is_default` on categories is informational.** It marks which categories were auto-created at registration, but it does not restrict what the user can do with them. Default categories can be renamed or deleted the same as custom ones.

**Uncategorised items** appear in a section labelled "Uncategorised" in all views. This is a virtual group, not a real category record.

**Weight input is always in grams** in the UI even when the display unit is imperial. The user types raw gram values; display conversion happens on read.

**Weight in the WeightTable shows base weight per category only.** Worn and consumable items are excluded from the per-category rows. The summary section below the category rows then adds back consumables (as "Consumables") and worn (as "Worn Weight") separately.
