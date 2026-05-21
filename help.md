# Help

grampacker helps you keep track of your backpacking gear, build packing lists, and see what your pack weighs.

## How grampacker works

grampacker is inventory first: your gear lives in your gear inventory (the **Gear** page), and each list pulls from that inventory.

Each list has a packing mode and a sharing mode. Packing mode lets you check off items as you pack. Sharing mode lets you share a read-only copy of your list with the public. Helpful for shakedowns and if you have an experienced hiker wants to make sure you aren't forgetting anything or bringing things you don't need.

## Basic concepts

### Gear inventory

Your gear inventory is the list of gear you own and the place to create and edit gear items. It's where weight, category, status, cost, and purchase date live.

Open the **Gear** page to add gear, edit existing items, or import gear from a CSV. The desktop list view also exposes a quick-add shortcut that creates inventory gear inline.

### Packing lists

A packing list is a trip specific set of gear. You can create different lists for different trips, seasons, or styles of travel.

Items on a list come from your gear inventory. If you edit an item's name, description, category, or weight, that change updates the inventory too.

### Categories

Categories organize gear into groups like Shelter, Sleep, Clothing, Food, or Electronics.

You can create, rename, delete, and reorder categories on the **Gear** page. Items can be moved between categories from the item edit dialog.

### Weight totals

grampacker uses three weight concepts:

- **Base weight**: gear you carry, not including consumables or worn items.
- **Consumables**: items like food, fuel, or water. These are tracked separately because their weight changes during a trip.
- **Pack weight**: includes base weight and consumables.

Worn items are things you wear instead of carry in your pack. They are not included in pack weight.

You can turn on **Group worn items** from a list's **List options** button to move worn items into their own Worn section. This applies while editing the list, in Pack mode, and on public shared links. This is helpful when packing, since you usually won't put your worn items inside your pack.

## Building a list

You can build a list in a few ways:

1. Create a new list and add items from your gear inventory.
2. On desktop, use the inline quick-add shortcut at the bottom of any category to create new gear and attach it to the list in one step.
3. Import a CSV from Lighterpack or another compatible spreadsheet.
4. Select items on the **Gear** page and create a list from that selection.

On desktop, the **Add from gear** picker appears next to your list. Click a gear item to add it to the list. Click it again to remove it.

On mobile, tap **Add** to open the gear picker. Search your gear, then tap items to add them. If you can't find the gear you want, create it on the **Gear** page first, then come back and add it to the list. Mobile list view doesn't create new gear directly; it's a picker over your gear inventory.

On the **Gear** page, use Select to choose multiple items. From there you can move items to a category, delete them, or create a new list from the selection.

## Editing items

On desktop, click an item's name, description, weight, or quantity to edit it directly. On mobile, tap an item to open the edit dialog.

For more options, open the item menu or edit dialog. Gear details like name, description, category, weight, status, cost, and purchase date are shared everywhere that gear appears. List-specific fields like quantity, worn status, and consumable status apply only to the current list.

Deleting from a list only removes the item from that list. Deleting from inventory removes it from your gear inventory and from any lists where it appears.

## Reordering

Drag items to reorder them within a category.

Drag categories on the **Gear** page to change the order they appear in your inventory and lists.

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

Ready checks add a second checkbox to each item in Pack mode, so you can mark an item Ready before it goes into your pack. Useful when you want to inspect, charge, refill, or stage gear before packing it. I've made this optional in case you don't want it.

Turn it on from the **Ready checks** toggle in the Pack mode options row. Ready checks is a per-list setting, so each list can have it on or off independently. It stays off by default. Turning it off hides the Ready UI but keeps any per-item Ready marks intact for next time.

When Ready checks are on, every row in Pack mode gets a Ready checkbox (amber) before the Packed checkbox (blue). The two states are independent: you can mark an item Ready without marking it Packed, and an item is only fully packed when its Packed checkbox is checked.

A second progress bar tracks how many items are Ready, alongside the Packed progress bar. Separate **Reset ready** and **Reset packed** buttons let you clear either state without affecting the other.

Like Packed, Ready checkmarks work offline and sync when you reconnect. Ready state is not shown on public share links.

### List options

The **List options** button (in the list toolbar on desktop, in the bottom action bar on mobile) opens current-list settings that apply across views:

- **Group worn items** moves worn items into their own section at the bottom of the list. Applies while editing, in Pack mode, and on public share links.
- **Sharing** turns on a public read-only link for the list and provides the URL to copy. Anyone with the link can view the list.

Pack mode controls like Ready checks and Show unpacked only live in Pack mode itself.

## Sharing a list

You can create a public read-only link for a list.

Open **List options**, turn on the public link under the Sharing section, and copy the URL. Anyone with the link can view the list without an account. Each row on the **Lists** page also has a **Share** action in its menu if you want to manage public links from there.

Public links are read-only. Other people cannot edit your list.

Turn the public link off to stop sharing the list.

Public lists may be discoverable, so only share lists you are comfortable making public.

## Importing and exporting

You can import gear or lists from CSV files.

Lighterpack CSV exports should work as a starting point. You can also use your own spreadsheet if it has compatible columns. At minimum, your CSV needs a name column and a weight column.

From Settings, you can export your account data as a zip file. The export includes your gear inventory and lists. This is a good way to backup your data.

## Mobile and offline use

grampacker works in a mobile browser and can be added to your home screen so it opens like an app.

For offline use, open the lists you need while you still have a connection. Previously opened lists may still be available when offline.

Packing checkmarks work offline and sync when you reconnect. Other edits, like changing list items or quantities, still need a connection.

## Account and privacy

grampacker is free to use and does not show ads.z

Your private gear and lists are only available to your account. A list becomes publicly viewable only when you turn on its public link.

You can delete your account from Settings.

## Contact

For bugs or feature ideas: hello [at] grampacker [dot] app.
