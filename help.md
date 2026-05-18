# Help

grampacker helps you keep track of your backpacking gear, build packing lists, and see what your pack weighs.

## How grampacker works

grampacker is inventory-first: your gear lives in **Gear Inventory**, and each list pulls from that inventory. Keeping one master list of gear means weights, categories, status, cost, and other details stay consistent across every trip.

On desktop, list rows include an inline quick-add shortcut for fast keyboard planning — that shortcut creates the new gear in your inventory and adds it to the current list in one step. On mobile, tap **Add** to choose existing gear from your inventory; create brand-new gear in **Gear Inventory** first, then add it to a list.

## Basic concepts

### Gear inventory

Your gear inventory is the master list of gear you own and the canonical place to create and edit full gear items. It's where weight, category, status, cost, and purchase date live, so each list inherits the same details and stays consistent across trips.

Open **Gear Inventory** to add gear, edit existing items, or import gear from a CSV. The desktop list view also exposes a quick-add shortcut that creates inventory gear inline.

### Packing lists

A packing list is a trip-specific set of gear. You can create different lists for different trips, seasons, or styles of travel.

Items on a list come from your gear inventory. If you edit an item's name, description, category, or weight, that change updates the inventory too.

### Categories

Categories organize gear into groups like Shelter, Sleep, Clothing, Food, or Electronics.

You can create, rename, delete, and reorder categories in the Gear Library. Items can be moved between categories from the item edit dialog.

### Weight totals

grampacker uses three weight concepts:

- **Base weight**: gear you carry, not including consumables or worn items.
- **Consumables**: items like food, fuel, or water. These are tracked separately because their weight changes during a trip.
- **Worn items**: things you wear instead of carry in your pack.

Pack weight includes base weight and consumables. Total weight includes pack weight plus worn items.

You can turn on **Group worn items** from a list's **List options** button to move worn items into their own Worn section. This applies while editing the list, in Pack mode, and on public shared links.

## Building a list

You can build a list in a few ways:

1. Create a new list and add items from your gear inventory.
2. On desktop, use the inline quick-add shortcut at the bottom of any category to create new gear and attach it to the list in one step.
3. Import a CSV from Lighterpack or another compatible spreadsheet.
4. Select items in Gear Inventory and create a list from that selection.

On desktop, the library panel appears next to your list. Click an inventory item to add it to the list. Click it again to remove it.

On mobile, tap **Add** to open the inventory picker. Search your inventory, then tap items to add them. If you can't find the gear you want, create it in **Gear Inventory** first — then come back and add it to the list. Mobile list view doesn't create new gear directly; it's a picker over your inventory.

In the Gear Library, use Select to choose multiple items. From there you can move items to a category, delete them, or create a new list from the selection.

## Editing items

On desktop, click an item's name, description, weight, or quantity to edit it directly. On mobile, tap an item to open the edit dialog.

For more options, open the item menu or edit dialog. From a list, you can change category, quantity, worn status, and consumable status. From the Gear Library, you can also manage cost and purchase date.

Deleting from a list only removes the item from that list. Deleting from inventory removes it from your gear library and from any lists where it appears.

## Reordering

Drag items to reorder them within a category.

Drag categories in the Gear Library to change the order they appear in your inventory and lists.

To move an item to a different category, open the item edit dialog and choose a category.

## Pack mode

Pack mode is a simplified checklist view for packing your bag.

Open a list and switch to Pack mode. Tap items as they go into your pack.

Pack mode includes controls to:

- **Show unpacked only** — filter packed items out of view as you work.
- **Reset packed** — clear all packed checkmarks for this list.
- **Ready checks** — turn on a second checkbox per item (see below).

Pack mode is intentionally simple so it is easy to use while packing.

### Ready checks

Ready checks add a second checkbox to each item in Pack mode, so you can mark an item Ready before it goes into your pack. Useful when you want to inspect, charge, refill, or stage gear before the final pack pass.

Turn it on from the **Ready checks** toggle in the Pack mode options row. Ready checks is a per-list setting, so each list can have it on or off independently. It stays off by default. Turning it off hides the Ready UI but keeps any per-item Ready marks intact for next time.

When Ready checks are on, every row in Pack mode gets a Ready checkbox (amber) before the Packed checkbox (blue). The two states are independent: you can mark an item Ready without marking it Packed, and an item is only fully packed when its Packed checkbox is checked.

A second progress bar tracks how many items are Ready, alongside the Packed progress bar. Separate **Reset ready** and **Reset packed** buttons let you clear either state without affecting the other.

Like Packed, Ready checkmarks work offline and sync when you reconnect. Ready state is not shown on public share links.

### List options

The **List options** button near the top of a list opens current-list settings that apply across views:

- **Group worn items** moves worn items into their own section at the bottom of the list. Applies while editing, in Pack mode, and on public share links.
- **Sharing** turns on a public read-only link for the list and provides the URL to copy. Anyone with the link can view the list.

Pack mode controls like Ready checks and Show unpacked only live in Pack mode itself.

## Sharing a list

You can create a public read-only link for a list.

Open **List options**, turn on the public link under the Sharing section, and copy the URL. Anyone with the link can view the list without an account. The All lists page also has a per-card Share button if you want to manage public links from the list library.

Public links are read-only. Other people cannot edit your list.

Turn the public link off to stop sharing the list.

Public lists may be discoverable, so only share lists you are comfortable making public.

## Importing and exporting

You can import gear or lists from CSV files.

Lighterpack CSV exports should work as a starting point. You can also use your own spreadsheet if it has compatible columns. At minimum, your CSV needs a name column and a weight column.

From Settings, you can export your account data as a zip file. The export includes your gear inventory and lists.

## Mobile and offline use

grampacker works in a mobile browser and can be added to your home screen so it opens like an app.

For offline use, open the lists you need while you still have a connection. Previously opened lists may still be available when offline.

Packing checkmarks work offline and sync when you reconnect. Other edits, like changing list items or quantities, still need a connection.

## Account and privacy

grampacker is free to use and does not show ads.

Your private gear and lists are only available to your account. A list becomes publicly viewable only when you turn on its public link.

You can delete your account from Settings.

## Contact

For bugs or feature ideas: hello [at] grampacker [dot] app.
