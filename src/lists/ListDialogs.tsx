import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ListItemPatch } from '../lib/queries'
import type { Category, GearItem, ListItemWithGear, PackingLocation } from '../lib/types'
import { runGuardedSave } from '../lib/guarded-save'
import GearItemDialog from '../components/gear/GearItemDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import QuickEditItemModal from './QuickEditItemModal'
import type { useListGearActions } from './use-list-gear-actions'
import type { useListItemActions } from './use-list-item-actions'

// Every transient dialog on the list detail page lives in one discriminated
// union, set and cleared atomically. `null` is the closed state (the same
// pattern as src/gear/GearLibraryPage.tsx). The editors fold the optional
// list-item context AND the partial-save error into one variant, so closing
// the dialog or switching items discards the error with no separate state.
export type DialogState =
  | { type: 'edit-gear'; gear: GearItem; listItem: ListItemWithGear | null; saveError: string | null }
  // The phone editor: name, weight, quantity, flags. Same shape as edit-gear
  // so More details can switch between them without losing the target.
  | { type: 'quick-edit-item'; gear: GearItem; listItem: ListItemWithGear | null; saveError: string | null }
  // `returnDialog` lets the confirm restore the dialog it was launched from
  // on cancel, so the user lands back in the form they were editing. Omitted
  // for deletes launched directly from a row.
  | { type: 'delete-gear'; candidate: GearItem; returnDialog?: DialogState }
  // The ONLY removal that asks. A list item can be USED AS a packing
  // container, and removing it removes that container too, moving its
  // contents to Unassigned - intended, but more than the row that was
  // clicked. See list-item-removal.ts for the rule.
  //
  // `location` is null in the fail-safe case: the packing-locations lookup
  // failed, so we could not establish whether this row is a container.
  | {
      type: 'remove-container-item'
      item: ListItemWithGear
      location: PackingLocation | null
      returnDialog?: DialogState
    }
  // Delete a packing location, or stop using an item as a container.
  | { type: 'delete-location'; location: PackingLocation }

type GearActions = ReturnType<typeof useListGearActions>
type ItemActions = ReturnType<typeof useListItemActions>

type Props = {
  dialog: DialogState | null
  setDialog: Dispatch<SetStateAction<DialogState | null>>
  categories: Category[]
  gearActions: GearActions
  updateItem: ItemActions['updateItem']
  deleteItem: ItemActions['deleteItem']
  requestRemoveListItem: (item: ListItemWithGear, returnDialog?: DialogState) => void
  removeLocation: (locationId: string) => void
}

export default function ListDialogs({
  dialog,
  setDialog,
  categories,
  gearActions: { updateGearItem, deleteGearItem, addCategory },
  updateItem,
  deleteItem,
  requestRemoveListItem,
  removeLocation,
}: Props) {
  // The editor save currently awaiting a response, held as the exact
  // DialogState object it was submitted from. It is both the dialog's own
  // pending flag (the mutations behind it also serve inline row writes, so
  // their `isPending` is not this dialog's) and the identity a late
  // completion is checked against before it touches the screen.
  const [savingAttempt, setSavingAttempt] = useState<DialogState | null>(null)

  // The full and quick editors' save. It runs sequentially: gear first, then
  // the list-item patch, and a failed gear write skips the list one. So
  // "both failed" cannot happen.
  //
  // The messages say UNCONFIRMED rather than "not applied": a rejected
  // mutateAsync does not prove the server did not commit (the connection can
  // drop after the PATCH lands, and apiFetch also rejects when a 200 fails
  // DTO validation). Retrying is safe because both stages are PATCHes, and a
  // refresh shows the truth.
  //
  // The dialog stays dismissable while saving (abandoning a slow save is
  // legitimate), so completion goes through runGuardedSave's identity guard
  // (src/lib/guarded-save.ts); installing `attempt` also clears the previous
  // try's error.
  function saveGearAndItem(
    current: Extract<DialogState, { type: 'edit-gear' | 'quick-edit-item' }>,
    gearPatch: Parameters<typeof updateGearItem.mutateAsync>[0]['patch'],
    listPatch: ListItemPatch | null,
  ) {
    const attempt: DialogState = { ...current, saveError: null }
    const gearTarget = current.gear
    const listTarget = current.listItem
    runGuardedSave<DialogState>({
      attempt,
      setState: setDialog,
      setSaving: setSavingAttempt,
      run: async (settle) => {
        try {
          await updateGearItem.mutateAsync({ id: gearTarget.id, patch: gearPatch })
        } catch {
          settle((prev) => ({
            ...prev,
            saveError: "Couldn't confirm those gear changes saved. Try again, or refresh to check.",
          }))
          return
        }
        if (listPatch && listTarget) {
          try {
            await updateItem.mutateAsync({ itemId: listTarget.id, patch: listPatch })
          } catch {
            settle((prev) => ({
              ...prev,
              saveError:
                "Saved the gear changes, but couldn't confirm the update to this list item. Try again, or refresh to check.",
            }))
            return
          }
        }
        settle(() => null)
      },
    })
  }

  switch (dialog?.type) {
    case undefined:
      return null

    // Reached from the kebab's Edit on any viewport. When a list item
    // accompanies the gear item, GearItemDialog renders an "On this list"
    // section with quantity / worn / consumable controls.
    case 'edit-gear': {
      const listItem = dialog.listItem
      return (
        <GearItemDialog
          key={dialog.gear.id}
          categories={categories}
          item={dialog.gear}
          listContext={
            listItem
              ? {
                  quantity: listItem.quantity,
                  isWorn: listItem.isWorn,
                  isConsumable: listItem.isConsumable,
                }
              : undefined
          }
          // Per attempt, not the mutations' shared isPending: those also
          // report inline row writes behind this dialog, and `saving` freezes
          // the form.
          saving={savingAttempt === dialog}
          saveError={dialog.saveError}
          onClose={() => setDialog(null)}
          onCreateCategory={(categoryName) => addCategory.mutateAsync(categoryName)}
          onSave={(gearPatch, listPatch) => saveGearAndItem(dialog, gearPatch, listPatch)}
          onRemoveFromList={
            listItem
              ? () => {
                  // Close the editor first: a plain item removes with no
                  // confirm, and the dialog must not stay open over a row
                  // that no longer exists. If a confirm IS needed,
                  // requestRemoveListItem opens it and `returnDialog`
                  // restores the editor on cancel.
                  setDialog(null)
                  requestRemoveListItem(listItem, dialog)
                }
              : undefined
          }
          onDeleteFromInventory={
            listItem
              ? () => setDialog({ type: 'delete-gear', candidate: dialog.gear, returnDialog: dialog })
              : undefined
          }
        />
      )
    }

    // The phone row tap's compact editor. More details switches to the full
    // GearItemDialog with the same target, so nothing is looked up again.
    case 'quick-edit-item':
      return (
        <QuickEditItemModal
          key={dialog.gear.id}
          gear={dialog.gear}
          listItem={dialog.listItem}
          saving={savingAttempt === dialog}
          saveError={dialog.saveError}
          onClose={() => setDialog(null)}
          // The drafts travel into the full form by overlaying the snapshots
          // it initializes from. GearItemDialog computes its save from its
          // own form values, so a draft-seeded baseline changes what the
          // form SHOWS, never what a save would write on its own.
          onMoreDetails={(gearDraft, listDraft) =>
            setDialog({
              type: 'edit-gear',
              gear: { ...dialog.gear, ...gearDraft },
              listItem:
                dialog.listItem && listDraft
                  ? { ...dialog.listItem, ...listDraft }
                  : dialog.listItem,
              saveError: null,
            })
          }
          onSave={(gearPatch, listPatch) => saveGearAndItem(dialog, gearPatch, listPatch)}
        />
      )

    // Removing a row that is USED AS a packing container also removes that
    // container and moves its contents to Unassigned. That is intended -
    // gear-backed containers cannot outlive their gear - but it changes more
    // than the row that was clicked, so it is named first. The copy is
    // descriptive, not alarming.
    case 'remove-container-item':
      return (
        <ConfirmDialog
          title={dialog.location ? 'Remove container from list' : 'Remove from list'}
          message={dialog.location
            ? `"${dialog.item.gearItem.name}" is being used as a packing container. Removing it from this list also removes the "${dialog.location.name}" container, and anything packed inside it moves to Unassigned. The gear item stays in your library.`
            // Fail-safe wording: the packing locations did not load, so we
            // cannot say whether this row is a container. Claiming it is
            // would be a guess; saying nothing would spring the container
            // removal on the user unannounced.
            : `Couldn't check whether "${dialog.item.gearItem.name}" is being used as a packing container. If it is, removing it also removes that container and moves its contents to Unassigned. The gear item stays in your library.`}
          confirmLabel="Remove"
          dangerous
          onCancel={() => setDialog(dialog.returnDialog ?? null)}
          onConfirm={() => {
            setDialog(null)
            deleteItem.mutate(dialog.item.id)
          }}
        />
      )

    // Removes the gear item from the library and cascades to every list item
    // that references it (ON DELETE CASCADE on gear_item_id).
    case 'delete-gear':
      return (
        <ConfirmDialog
          title="Delete from inventory"
          message={`This will remove "${dialog.candidate.name}" from your inventory and from any list it appears on. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          onCancel={() => setDialog(dialog.returnDialog ?? null)}
          onConfirm={() => {
            setDialog(null)
            deleteGearItem.mutate(dialog.candidate.id)
          }}
        />
      )

    // Deleting a location does not touch the gear in it - its items fall back
    // to Unassigned - so this is recoverable by creating the location again,
    // unlike removing the backing ITEM (which has its own confirm above).
    case 'delete-location': {
      const { location } = dialog
      const isPlain = location.containerListItemId === null
      return (
        <ConfirmDialog
          title={isPlain ? 'Delete packing location' : 'Stop using item as container'}
          message={isPlain
            ? `Delete "${location.name}"? Its items will move to Unassigned.`
            : `Stop using "${location.name}" as a container? Its items will move to Unassigned.`}
          confirmLabel={isPlain ? 'Delete' : 'Stop using'}
          dangerous={isPlain}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            removeLocation(location.id)
          }}
        />
      )
    }
  }
}
