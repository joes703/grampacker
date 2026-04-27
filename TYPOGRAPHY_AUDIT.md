# Typography audit

Catalogue of every distinct combination of Tailwind text-size + font-weight + text-color classes on text-bearing elements across `src/` (36 .tsx files). Combinations are listed with every callsite. Inconsistencies are flagged at the end.

Conventions:
- `default` for size/weight/color = no explicit class (inherits or relies on browser/Tailwind defaults).
- Conditional classes (`isActive ? 'text-gray-900' : 'text-gray-600'`) are split into separate combinations.
- Decorations (`italic`, `line-through`, `tabular-nums`, `tracking-wide/wider`, `uppercase`, `font-mono`) are noted alongside the triple.

---

## 1. Page titles (h1)

### `text-2xl font-bold text-gray-900`
1. `auth/LoginPage.tsx` — "Sign in" heading
2. `auth/SignupPage.tsx` — "Create account" heading
3. `lists/SharePage.tsx` — public list name on share page

**3 callsites.** Primary page heading on unauthenticated / public pages.

### `text-xl font-semibold text-gray-900`
1. `lists/InlineTitle.tsx` — list name h1 on `ListDetailPage` (both display and editing modes)
2. `lists/ListsEmptyState.tsx` — "Create your first list" heading
3. `settings/SettingsPage.tsx` — "Settings" page heading

**3 callsites.** Authenticated-app primary heading.

### `text-xl font-bold text-gray-900`
1. `gear/GearLibraryPage.tsx` — "Gear Library" page heading

**1 callsite.**

---

## 2. Dialog / modal titles (h2)

### `text-base font-semibold text-gray-900`
1. `components/ConfirmDialog.tsx` — generic confirm dialog title
2. `components/TypedConfirmDialog.tsx` — typed confirm dialog title
3. `gear/GearItemDialog.tsx` — "New item" / "Edit item" title
4. `gear/CreateListFromSelectionDialog.tsx` — "Create list from selection" title
5. `gear/GearImportPreviewDialog.tsx` — "Import N items" title
6. `gear/BulkMoveCategoryDialog.tsx` — "Move N items to category" title
7. `lists/ListImportPreviewDialog.tsx` — "Import N items to list" title
8. `lists/ListDetailPage.tsx` — "Import error" modal title
9. `gear/GearLibraryPage.tsx` — "Import error" modal title
10. `settings/SettingsPage.tsx` — section titles ("Account", "Download", danger zone, etc.)

**10 callsites.**

### `text-base font-semibold text-red-700`
1. `settings/SettingsPage.tsx` — danger-zone section title (variant of the above for destructive sections)

**1 callsite.**

---

## 3. Section / panel headers

### `text-xs font-semibold text-gray-500` + `uppercase tracking-wide`
1. `lists/ListDetailPage.tsx` — "Notes" / "Weight summary" `PanelCard` titles
2. `lists/ListDetailPage.tsx` — "Gear library" header on the embedded library panel
3. `lists/ListsBox.tsx` — "Lists" header
4. `lists/LibraryPanel.tsx` — "Gear library" panel header
5. `lists/LibraryPanel.tsx` — category-group headers inside the panel
6. `lists/SharePage.tsx` — `SharedPanelCard` titles ("Notes", "Weight summary")

**6 callsites.**

### `text-[10px] font-semibold text-gray-500` + `uppercase tracking-wider`
1. `lists/ListCategoryGroup.tsx` — "Qty" column header
2. `lists/ListCategoryGroup.tsx` — "Weight" column header
3. `lists/SharePage.tsx` — `SharedCategoryGroup` "Qty" column header
4. `lists/SharePage.tsx` — `SharedCategoryGroup` "Weight" column header

**4 callsites.**

### `text-xs font-medium text-gray-500`
1. `lists/ListImportPreviewDialog.tsx` — `<thead>` cells (Name, Weight, Category, Flags)
2. `gear/GearImportPreviewDialog.tsx` — `<thead>` cells (Name, Weight, Category)

**2 callsites.**

---

## 4. Primary content (item names, list names)

### `text-sm font-medium text-gray-900`
1. `lists/ListItemRow.tsx` — item name (edit mode and pack-mode unpacked branch)
2. `lists/SharePage.tsx` — `SharedItemRow` item name
3. `gear/GearItemRow.tsx` — gear-item name
4. `lists/AddItemRow.tsx` — name input (font-medium on the input itself)

**4 callsites.**

### `text-sm font-medium text-gray-800`
1. `lists/PrivacyButton.tsx` — "Public link" label inside popover
2. `lists/LibraryPanel.tsx` — gear-item name when *in* the current list
3. `lists/LibrarySheet.tsx` — "Gear library" drawer title
4. `lists/ListImportPreviewDialog.tsx` — item name in preview table
5. `gear/GearImportPreviewDialog.tsx` — item name in preview table
6. `gear/CategorySection.tsx` — category name (not renaming)

**6 callsites.**

### `text-sm font-medium text-gray-400`
1. `lists/LibraryPanel.tsx` — gear-item name when *not* in the current list (de-emphasized)
2. `lists/ListItemRow.tsx` — item name when packed (also `line-through`)

**2 callsites.**

### `text-sm font-medium text-gray-700`
1. `lists/ListCategoryGroup.tsx` — category-group header name
2. `lists/SharePage.tsx` — `SharedCategoryGroup` category name
3. `lists/PackingProgress.tsx` — "X / Y packed" label

**3 callsites.**

### `text-base font-medium text-gray-700`
1. `lists/SharePage.tsx` — "List not found" message

**1 callsite.**

### `text-sm text-blue-700 font-medium` (active branch)
1. `lists/ListsBox.tsx` — `ListsBoxRow` active list

**1 callsite.** Paired with `text-sm text-gray-700` for the inactive branch (see §5).

---

## 5. Secondary content (descriptions, list rows, body)

### `text-sm text-gray-700`
1. `lists/ListsBox.tsx` — list-row name (inactive branch of conditional)
2. `lists/WeightTable.tsx` — table cells (`<tbody>` base text)
3. `lists/SharePage.tsx` — notes content
4. `lists/PrivacyButton.tsx` — copy-button text and share-URL input

**4 callsites.**

### `text-sm text-gray-600`
1. `components/ConfirmDialog.tsx` — message body
2. `components/TypedConfirmDialog.tsx` — message body
3. `gear/CreateListFromSelectionDialog.tsx` — "{N} item(s) will be added…" line
4. `lists/ListImportPreviewDialog.tsx` — preview-table weight cell (`tabular-nums`)
5. `gear/GearImportPreviewDialog.tsx` — preview-table weight cell (`tabular-nums`)
6. `lists/SharePage.tsx` — `SharedItemRow` weight / qty cells (`tabular-nums`)
7. `lists/ListItemRow.tsx` — quantity / weight buttons (`tabular-nums`)
8. `lists/LibraryPanel.tsx` — search input
9. `gear/GearItemRow.tsx` — item-weight cell (`tabular-nums`)
10. `gear/BulkActionsToolbar.tsx` — "{N} selected" (normal branch of conditional)
11. `settings/SettingsPage.tsx` — delete-account warning paragraph
12. `layout/NavBar.tsx` — "Sign out" button text
13. `gear/GearLibraryPage.tsx` — "Back to list" / "Back to lists" link
14. `lists/ListDetailPage.tsx` — list-not-found message

**14 callsites.**

### `text-sm font-medium text-gray-600`
1. `lists/ListDetailPage.tsx` — `g`/`oz` toggle button
2. `gear/GearLibraryPage.tsx` — `g`/`oz` toggle button
3. `gear/GearLibraryPage.tsx` — Select / Cancel toggle button
4. `gear/GearLibraryPage.tsx` — Export button
5. `gear/GearLibraryPage.tsx` — Import button

**5 callsites.**

### `text-xs text-gray-500`
1. `lists/ListItemRow.tsx` — item description (edit mode)
2. `lists/ListItemRow.tsx` — item description (pack mode)
3. `lists/SharePage.tsx` — `SharedItemRow` description
4. `lists/PrivacyButton.tsx` — "Anyone with this link can view the list." / "Toggle on to share…" instructions
5. `lists/ListImportPreviewDialog.tsx` — header instruction line ("New items will be added to your gear library…")
6. `lists/ListImportPreviewDialog.tsx` — category cell in preview table
7. `lists/PackingProgress.tsx` — "Reset" button text
8. `auth/SignupPage.tsx` — "8–128 characters" password hint
9. `components/TypedConfirmDialog.tsx` — "Type the phrase to confirm:" instruction
10. `settings/SettingsPage.tsx` — section subtitles
11. `gear/GearImportPreviewDialog.tsx` — category cell in preview table

**11 callsites.**

### `text-xs text-gray-400`
1. `lists/ListCategoryGroup.tsx` — item count in category header (`(N)` / `M / N`)
2. `lists/ListCategoryGroup.tsx` — "+ Add new item" button (`hover:text-blue-600`)
3. `lists/LibraryPanel.tsx` — item count in category-group header
4. `lists/SharePage.tsx` — "Made with grampacker" footer
5. `gear/CategorySection.tsx` — "No items" empty-state row

**5 callsites.**

### `text-xs text-gray-400 italic`
1. `lists/ListsBox.tsx` — "No lists yet" empty-state
2. `lists/LibraryPanel.tsx` — "No items found" / "No gear items yet" empty-state

**2 callsites.**

### `text-sm text-gray-400`
1. `layout/AppShell.tsx` — `<NotFound>` "Page not found"
2. `lists/ListDetailPage.tsx` — "No items — add from your gear library" empty-state
3. `lists/SharePage.tsx` — link-validity error message
4. `gear/GearLibraryPage.tsx` — "Loading…" placeholder

**4 callsites.**

### `text-sm text-gray-400 italic`
1. `lists/SharePage.tsx` — "No notes" placeholder

**1 callsite.**

### `text-sm text-gray-500`
1. `lists/ListsEmptyState.tsx` — explanation paragraph under heading
2. `gear/GearLibraryPage.tsx` — "Back to list" link (when arriving via deep link, fallback variant)
3. `gear/BulkActionsToolbar.tsx` — "Deselect all" link

**3 callsites.** (See §11 — used as a "secondary action / muted helper" cluster.)

### `text-sm font-normal text-gray-500`
1. `gear/GearLibraryPage.tsx` — "{N} items" count next to "Gear Library" heading

**1 callsite.**

---

## 6. Numeric / tabular values

### `text-sm tabular-nums` (no explicit color, e.g. inputs)
1. `lists/AddItemRow.tsx` — quantity / weight number inputs
2. `lists/WeightTable.tsx` — weight values (`<td>` cells)

**2 callsites.**

### `text-sm font-semibold text-gray-700 tabular-nums`
1. `lists/WeightTable.tsx` — totals rows (base weight, consumables, total pack weight)

**1 callsite.**

### `text-xs font-semibold text-gray-700 tabular-nums`
1. `lists/ListCategoryGroup.tsx` — category total weight in footer
2. `lists/SharePage.tsx` — category total weight in `SharedCategoryGroup` footer

**2 callsites.**

### `text-xs tabular-nums text-gray-500`
1. `lists/ListItemRow.tsx` — quantity in pack mode
2. `lists/LibraryPanel.tsx` — item weight in panel

**2 callsites.**

---

## 7. Buttons

### `text-sm font-medium text-white` (on blue-600 / blue-700 backgrounds — primary action)
1. `auth/LoginPage.tsx` — "Sign in"
2. `auth/SignupPage.tsx` — "Create account"
3. `lists/ListsEmptyState.tsx` — "Create"
4. `gear/GearLibraryPage.tsx` — "New item"
5. `gear/GearLibraryPage.tsx` — "Add" category
6. `gear/GearItemDialog.tsx` — "Add item" / "Save changes"
7. `gear/BulkMoveCategoryDialog.tsx` — "Move"
8. `gear/CreateListFromSelectionDialog.tsx` — "Create list"
9. `gear/GearImportPreviewDialog.tsx` — "Import N items"
10. `lists/ListImportPreviewDialog.tsx` — "Import N items to list"
11. `components/ConfirmDialog.tsx` — confirm button (non-dangerous variant)
12. `settings/SettingsPage.tsx` — "Change password"

**12 callsites.**

### `text-sm font-medium text-white` (on red-600 — destructive)
1. `components/ConfirmDialog.tsx` — confirm button (`dangerous=true` variant)
2. `components/TypedConfirmDialog.tsx` — typed-delete button
3. `gear/BulkActionsToolbar.tsx` — "Delete (N)"

**3 callsites.**

### `text-sm font-medium text-gray-700` (on gray-100 hover — secondary / cancel)
1. `components/ConfirmDialog.tsx` — Cancel
2. `components/TypedConfirmDialog.tsx` — Cancel
3. `gear/GearItemDialog.tsx` — Cancel
4. `gear/CreateListFromSelectionDialog.tsx` — Cancel
5. `gear/BulkMoveCategoryDialog.tsx` — Cancel
6. `gear/GearImportPreviewDialog.tsx` — Cancel
7. `lists/ListImportPreviewDialog.tsx` — Cancel
8. `gear/BulkActionsToolbar.tsx` — "Create list" (toolbar variant)
9. `gear/BulkActionsToolbar.tsx` — "Move to category"
10. `settings/SettingsPage.tsx` — "Download .zip"

**10 callsites.**

### `text-sm font-medium text-red-700` (destructive secondary)
1. `settings/SettingsPage.tsx` — "Delete my account"
2. `gear/BulkActionsToolbar.tsx` — "{N} selected · max 300 per list" warning span (over-cap branch)

**2 callsites.**

### `text-sm text-blue-600` (link / link-styled action)
1. `auth/LoginPage.tsx` — "Create one" register link
2. `auth/SignupPage.tsx` — "Sign in" login link
3. `lists/ListsBox.tsx` — "+ New list" button text
4. `lists/ListDetailPage.tsx` — "Manage →" gear-library link
5. `gear/BulkActionsToolbar.tsx` — "Select all" link

**5 callsites.**

### `text-xs text-gray-700`
1. `lists/PrivacyButton.tsx` — Copy / Copied button text

**1 callsite.**

---

## 8. Form labels

### `text-sm font-medium text-gray-700`
1. `auth/LoginPage.tsx` — Email label
2. `auth/LoginPage.tsx` — Password label
3. `auth/SignupPage.tsx` — Email label
4. `auth/SignupPage.tsx` — Password label
5. `gear/GearItemDialog.tsx` — Name / Description / Weight / Category labels
6. `gear/CreateListFromSelectionDialog.tsx` — "List name" label
7. `gear/CreateListFromSelectionDialog.tsx` — "Description" label
8. `settings/SettingsPage.tsx` — "New password" / "Confirm new password" labels

**8 callsites (≈12 individual labels).**

### `text-xs font-normal text-gray-400`
1. `gear/CreateListFromSelectionDialog.tsx` — "(optional)" suffix on description label

**1 callsite.**

---

## 9. Inputs / textareas (text content)

### `text-sm` (no explicit weight, no explicit color — inherits)
1. `auth/LoginPage.tsx` — Email / Password inputs
2. `auth/SignupPage.tsx` — Email / Password inputs
3. `gear/GearItemDialog.tsx` — Name / Description / Weight / Category select
4. `gear/CreateListFromSelectionDialog.tsx` — List-name input, description textarea
5. `gear/BulkMoveCategoryDialog.tsx` — Category `<select>`
6. `gear/GearLibraryPage.tsx` — Search input, "Add category" name input
7. `lists/LibraryPanel.tsx` — Search input
8. `lists/ListsBox.tsx` — New-list-draft input
9. `lists/ListsEmptyState.tsx` — List-name input
10. `lists/ListDetailPage.tsx` — (search inputs in inner library panel)
11. `settings/SettingsPage.tsx` — Password inputs

**11 callsites (~15 individual inputs).**

### `text-xs` on `<input>` (no explicit weight or color)
1. `lists/AddItemRow.tsx` — description input

**1 callsite.**

### `text-xs font-mono text-gray-700`
1. `lists/PrivacyButton.tsx` — share-URL `<input readOnly>`

**1 callsite.**

### `text-xs font-mono font-semibold text-gray-700`
1. `components/TypedConfirmDialog.tsx` — confirmation phrase rendered as inline `<code>`-ish span

**1 callsite.**

---

## 10. Status / badges / inline indicators

### `text-xs font-medium text-green-700` (on green-100 background)
1. `lists/PackingProgress.tsx` — "All packed!" badge

**1 callsite.**

### `text-purple-600` (alongside `text-xs`)
1. `lists/ListImportPreviewDialog.tsx` — "W" worn flag in preview table

**1 callsite.**

### `text-orange-600` (alongside `text-xs`)
1. `lists/ListImportPreviewDialog.tsx` — "C" consumable flag in preview table

**1 callsite.**

### `text-xs font-medium`
1. `gear/CategorySection.tsx` — category-name input (rename mode, no explicit color)

**1 callsite.**

### `text-xs font-normal text-gray-500`
1. `gear/CategorySection.tsx` — item count next to category name

**1 callsite.**

---

## 11. Errors and alerts

### `text-sm text-red-600`
1. `auth/LoginPage.tsx` — form error message
2. `auth/SignupPage.tsx` — form error message
3. `lists/ListDetailPage.tsx` — import-error modal body
4. `gear/GearLibraryPage.tsx` — import-error modal body
5. `settings/SettingsPage.tsx` — change-password error
6. `settings/SettingsPage.tsx` — delete-account error
7. `settings/SettingsPage.tsx` — download error

**7 callsites.**

### `text-sm text-red-700` (inside red-50 alert box)
1. `gear/CreateListFromSelectionDialog.tsx` — list-cap alert
2. `gear/CreateListFromSelectionDialog.tsx` — item-cap alert

**2 callsites.**

### `text-sm text-green-600`
1. `settings/SettingsPage.tsx` — "Password updated" success message

**1 callsite.**

---

## 12. Navigation / brand

### `text-lg font-bold text-gray-900` (`hover:text-gray-700`)
1. `layout/NavBar.tsx` — "grampacker" logo `<Link>`

**1 callsite.**

### `text-sm font-medium` (conditional color)
1. `layout/NavBar.tsx` — Settings `<NavLink>`: `text-gray-900` (active) / `text-gray-600` (inactive)

**1 callsite, 2 branches.**

---

## 13. InlineText component (placeholder helper)

### `text-gray-400 italic` (size inherited from surrounding row context, typically `text-sm` or `text-xs`)
1. `components/InlineText.tsx` — placeholder text rendered when value is empty
2. Consumed indirectly by: `lists/ListItemRow.tsx` (description), `lists/NotesEditor.tsx` (notes), `lists/InlineTitle.tsx` (none — has its own h1 styling), `gear/GearItemRow.tsx` (description), `gear/CategorySection.tsx` (category-rename empty)

**1 component definition; ~4 indirect consumers.**

---

# Inconsistencies and one-offs

## A. Combinations used in only one place
Direct one-offs (one definition site, no duplicates):

- `text-2xl font-bold text-gray-900` → only on the three unauthenticated pages (Login, Signup, SharePage). The rest of the authenticated app uses `text-xl font-semibold text-gray-900`.
- `text-xl font-bold text-gray-900` → only on `gear/GearLibraryPage.tsx`. (Note the weight differs from the other authenticated h1s — see §F.)
- `text-base font-semibold text-red-700` → only on the danger-zone section title in Settings.
- `text-base font-medium text-gray-700` → only on `SharePage` "List not found" message.
- `text-xs font-medium text-green-700` → only on the "All packed!" badge.
- `text-purple-600` (size `text-xs`) → only on the worn flag in `ListImportPreviewDialog`.
- `text-orange-600` (size `text-xs`) → only on the consumable flag in `ListImportPreviewDialog`.
- `text-sm text-green-600` → only on the password-success message in Settings.
- `text-sm text-red-700` (alert-box variant) → only on the two cap alerts in `CreateListFromSelectionDialog`.
- `text-sm font-normal text-gray-500` → only on the "{N} items" count next to the Gear Library h1.
- `text-xs font-normal text-gray-400` → only on the "(optional)" form-label suffix in `CreateListFromSelectionDialog`.
- `text-xs font-normal text-gray-500` → only on the category-item count in `gear/CategorySection.tsx`.
- `text-xs font-mono text-gray-700` → only on the share-URL field in `PrivacyButton`.
- `text-xs font-mono font-semibold text-gray-700` → only on the confirmation-phrase span in `TypedConfirmDialog`.
- `text-lg font-bold text-gray-900` → only on the brand logo in NavBar.
- `text-sm font-medium text-red-700` → only used in two semantically unrelated spots (Settings delete-account button vs. the bulk-toolbar "over cap" warning).

## B. Page-heading hierarchy is inconsistent
Authenticated-app primary headings use **three** different combinations:

- `text-xl font-semibold text-gray-900` — `InlineTitle` (list detail), `ListsEmptyState`, Settings.
- `text-xl font-bold text-gray-900` — `GearLibraryPage`. (Same size as the other three, different weight.)
- `text-2xl font-bold text-gray-900` — Login, Signup, SharePage. (Bigger size than authenticated pages.)

Within the gear library page header, the count badge `text-sm font-normal text-gray-500` is sized like body text but lives next to a `text-xl` h1 — different sizing convention than the lists-page heading, which has no inline count.

## C. "Item / record name" role is split across three colors
The "primary, bold-ish item name" role appears in three colors with no obvious rule:

- `text-sm font-medium text-gray-900` — ListItemRow, GearItemRow, SharePage SharedItemRow, AddItemRow input.
- `text-sm font-medium text-gray-800` — LibraryPanel item-in-list, ListImportPreviewDialog table cell, GearImportPreviewDialog table cell, CategorySection category-name display, LibrarySheet drawer title, PrivacyButton "Public link".
- `text-sm font-medium text-gray-400` — LibraryPanel item-not-in-list (intentional de-emphasis) and ListItemRow packed item (paired with `line-through`, intentional).

The 900 vs 800 split looks accidental: identical roles (e.g. item names in `ListItemRow` vs. preview-dialog tables) use different shades.

## D. "Category-group header name" splits between weights
- `text-sm font-medium text-gray-700` — `lists/ListCategoryGroup` and `SharePage SharedCategoryGroup`.
- `text-sm font-medium text-gray-800` — `gear/CategorySection`.

Same conceptual role (a category header within a scrollable list), two different gray shades.

## E. Section-header cluster has size variants
"Uppercase, tracking, semibold" section headers come in two sizes for similar purposes:

- `text-xs font-semibold text-gray-500 uppercase tracking-wide` — panel/section titles (Notes, Weight summary, Lists, Gear library).
- `text-[10px] font-semibold text-gray-500 uppercase tracking-wider` — Qty / Weight column headers in item-list rows.

Different elements (panel chrome vs. column header), but the same visual treatment family with two slightly different settings.

Adjacent: `text-xs font-medium text-gray-500` is used for `<thead>` cells in the two import-preview dialogs, breaking the pattern (medium instead of semibold, no uppercase, no tracking) for what is also a column header role.

## F. Heading weight: `bold` vs `semibold`
The h1 heading role is split between `font-bold` (Login, Signup, SharePage, GearLibraryPage, NavBar logo) and `font-semibold` (InlineTitle/ListDetailPage, ListsEmptyState, Settings). The split correlates loosely with size (`text-2xl` and `text-lg` use bold; `text-xl` mostly uses semibold) — except `gear/GearLibraryPage.tsx` which is `text-xl font-bold`.

## G. Dialog body text role splits between `gray-600` and `gray-500`
- Body paragraph in dialog: `text-sm text-gray-600` (ConfirmDialog, TypedConfirmDialog, CreateListFromSelectionDialog, ListImportPreviewDialog header line).
- Helper / hint / instruction line in dialog: `text-xs text-gray-500` (TypedConfirmDialog "Type the phrase…", ListImportPreviewDialog instructions, SettingsPage subtitles, SignupPage password hint, PrivacyButton instructions).
- "Reset" / "Deselect all" / "Back to list" inline actions: variously `text-xs text-gray-500`, `text-sm text-gray-500`, or `text-sm text-gray-600`.

The three roles (body / hint / muted-action) share a similar muted-gray treatment but the size-color pairing is inconsistent across files.

## H. "Cancel button" is uniform; "secondary toolbar button" is not
Modal Cancel buttons consistently use `text-sm font-medium text-gray-700` (10 callsites). But other "secondary" toolbar buttons split:

- `text-sm font-medium text-gray-600` — `g`/`oz` toggle, Select/Cancel toggle, Export, Import in `GearLibraryPage`.
- `text-sm font-medium text-gray-700` — `BulkActionsToolbar` "Create list" / "Move to category".

Same visual class (small bordered button on white), two different gray weights for the label.

## I. Link styling
Inline link role is `text-sm text-blue-600` (5 callsites). But:

- `lists/ListsBox.tsx` "+ New list" uses `text-sm text-blue-600` styled as a button (consistent).
- `lists/ListDetailPage.tsx` "Manage →" uses `text-xs font-medium text-gray-500 hover:text-blue-600` — different size, different default color, hover-only blue. (One-off pattern.)
- `gear/GearLibraryPage.tsx` "Back to list" uses `text-sm text-gray-500 hover:text-blue-600` — yet another link variant.

Three different "navigate elsewhere" links, three different idle treatments.

## J. Empty-state placeholder roles split across color/italic combinations
- `text-xs text-gray-400 italic` — ListsBox "No lists yet", LibraryPanel empty messages.
- `text-xs text-gray-400` (no italic) — CategorySection "No items".
- `text-sm text-gray-400` (no italic) — AppShell `NotFound`, ListDetailPage no-items, GearLibraryPage "Loading…".
- `text-sm text-gray-400 italic` — SharePage "No notes".

Same conceptual role (empty / not-found / placeholder), four variants on size × italic.

## K. NavBar `ListsBoxRow` active state uses `text-blue-700` for foreground
`lists/ListsBox.tsx` is the only place where an active-row state changes the foreground to blue (`text-blue-700 font-medium`). All other active-state UI in the app (NavBar Settings link, the pack-mode and privacy toggle buttons, the gear bulk-select Cancel button) uses background color shifts only and keeps `text-gray-900` / `text-gray-600`.
