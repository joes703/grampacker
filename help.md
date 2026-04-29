# How to use grampacker

## Get started

If you have data in Lighterpack, export it as CSV and import it from /gear. Items, categories, weights, and worn/consumable flags come over.

If you're starting fresh, build up your gear inventory first or jump straight into a list and add items as you go.

## Concepts

You'll probably spend most of the time working in the list page. 
There are a few other pages/views you may find helpful: 
- Gear Library. All the gear you own is stored here. 
- List pack mode. This is a simplified view of your list, with checkboxes added to help you pack.
- Public share. You can enable and disable a public read only copy of a list. Helpful for getting advice on your list ahead of a trip.

Base weight is the weight of all of your gear minus consumables (food, fuel, water) and the things you wear. Total pack weight is base weight + consumables. Worn items are shown but are not added to anything else.

## Build a list

There are 3 ways to create a gear list. 

1. Import a CSV from Lighterpack (or with those columns) into a new list.
2. Import a CSV of your gear into the Gear Library, then either add items to a list from the gear picker, or select items in the Gear Library and create a new list from the selection.
3. Click on new item and start adding items.

The library panel on the left of a list shows your full inventory. Click an item to add it to the list. Click again to remove it.

You can also type a new name into the list itself. That creates the item in both the list and your inventory at the same time. The same trick works for categories: type a name that doesn't exist and you've made one.

## Edit and reorder

Click an item's name, description, or weight to edit it inline. Changes save automatically and update the inventory.

Drag any row up or down to reorder it within its category. To move an item to a different category, open the edit modal and pick from the Category dropdown.

The kebab menu (three dots) on each row has Edit, Remove from list, and Delete from inventory.

## Share a list

Click the globe icon at the top of a list. Flip the Public link toggle on, then copy the URL. Anyone with the link can view the list. They can't edit it, and they don't need an account. Flip the toggle off and the link stops working.

## Pack mode

Click the clipboard icon at the top of a list to enter Pack mode. Tap items to check them off as they go in the bag.

Two controls sit above the list. Unpacked only hides items you've already packed. Reset clears the checkmarks.

When you're standing over a half-packed bag the night before a 5am drive, you don't want to be navigating a UI. Pack mode is sparse on purpose.

## Gear library

Open /gear from the nav (top bar on desktop, bottom tab bar on mobile).

Click Select to enter multi-select. The bulk action toolbar appears at the bottom with Select all, Select none, Move to category, Delete, and Create list.

Each row has a kebab menu with Edit and Delete from inventory. Categories are draggable to reorder.

## Export and delete

Account settings has both: download a single zip with your full inventory and every list, or delete your account. Both are one click, no friction either way.

## FAQ

### Why a separate gear inventory?

I wanted a source of truth for everything I own. Lists can be built from inventory, and edits flow both ways in case you don't want to work in both. The inventory has its own multi-select mode (the Select button) for moving categories, deleting items, or creating a new list from your selection. I try not to force the inventory, so you can do most things from the list view.

### Why does editing a list item change the inventory?

Because most edits are real corrections. Those changes should stick across every list.

When you actually want a one-off, you can create a new item instead. The coupling is intentional so that you don't have to worry about where you created an item. 

### Why can't I drag from the picker?

Drag-and-drop is good for moving things you've already placed. It's slower than a click when you're picking from a long list. Inside a list, drag sorts and re-categorizes. From the picker, click adds and click again removes.

### Why no images?

Storage costs scale with users in a way I can't sustain for free. Hosting user-uploaded images also means moderating content, which I don't want to do.

### What's the tech stack and why?

**TypeScript** for the language. It adds types to JavaScript. The editor flags mistakes before I run the code, and the types serve as documentation when I come back to a file weeks later.

**React** for the UI. It's widely used, so when I get stuck, help is easy to find.

**Vite** for the build tool. It's fast and has almost nothing to configure.

**Supabase** for the backend. It handles authentication, the database, and access control in one service. The database is Postgres, so my data isn't locked into a proprietary format. Access rules are enforced at the database level using row-level security.

**Cloudflare Pages** for hosting. 

Fewer moving parts, fewer things to break, hopefully easier to maintain.

### Did you use AI to build this?

Yes. AI made it realistic for me to ship something working in a reasonable amount of time. Every design decision in this app is mine. The code that implements them was written with help.

## Contact

For bugs or feature ideas: hello [at] grampacker [dot] app.
