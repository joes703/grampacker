# How to use grampacker

## Get started

If you have data in Lighterpack, export it as CSV and import it from /gear. Items, categories, weights, and worn/consumable flags come over.

If you're starting fresh, build up your gear inventory first or jump straight into a list and add items as you go. Either works.

## Worn, consumable, and base weight

Pack weight is the most important number on a packing list, and most apps count it wrong. grampacker treats worn, consumable, and base as separate types so the totals match what's actually on your back.

To mark an item, tap the shirt icon (worn) or the crossed-utensils icon (consumable) on its row in a list. The same checkboxes are in the edit modal.

The three types:

- **Base** is gear that goes in your pack. Most things. The default.
- **Consumable** items are food, fuel, and water. They start full and end empty.
- **Worn** items are on your body when you start walking, like boots and trekking poles.

Each list shows two totals at the top:

- **Base weight** is the sum of your base items. The number most people optimize.
- **Total pack weight** is base plus consumables. It's what's actually on your back at the trailhead. Worn items aren't included because they aren't in your pack.

## Build a list

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

Three controls sit above the list. Unpacked only hides items you've already packed. Group worn pulls worn items into a section at the bottom (mirrors how worn gear sits by the door). Reset clears the checkmarks.

When you're standing over a half-packed bag the night before a 5am drive, you don't want to be navigating a UI. Pack mode is sparse on purpose.

## Gear library

Open /gear from the nav (top bar on desktop, bottom tab bar on mobile).

Click Select to enter multi-select. The bulk action toolbar appears at the bottom with Select all, Select none, Move to category, Delete, and Create list.

Each row has a kebab menu with Edit and Delete from inventory. Categories are draggable to reorder.

## Export and delete

Account settings has both: download a single zip with your full inventory and every list, or delete your account. Both are one click, no friction either way.

## FAQ

### Why a separate gear inventory?

Your inventory is the source of truth for everything you own. Each item lives there once, with one weight. Lists are built from inventory, and edits flow both ways. The inventory has its own Manage mode for bulk work: multi-select, move categories, delete, or turn a selection into a new list.

### Why does editing a list item change the inventory?

Because most edits are real corrections. I weighed it more accurately, I added a note, I fixed the brand name. Those changes should stick across every list.

When you actually want a one-off, like a borrowed item or a substitute for one trip, you can create a new item instead. The coupling is intentional.

### Why can't I drag from the picker?

Drag-and-drop is good for moving things you've already placed. It's slower than a click when you're picking from a long list. Inside a list, drag sorts and re-categorizes. From the picker, click adds and click again removes.

### Why no images?

Storage costs scale with users in a way I can't sustain for free. Hosting user-uploaded images also means moderating content, which I don't want to do.

### Why does grampacker work like an app on my phone?

grampacker is a Progressive Web App, or PWA. A PWA is a website you can add to your home screen so it behaves like an installed app. No app store, no install. I use packing mode on my phone often, and I wanted that to work well without anyone having to download a native app.

### What's the tech stack and why?

**TypeScript** for the language. It adds types to JavaScript. The editor flags mistakes before I run the code, and the types serve as documentation when I come back to a file weeks later.

**React** for the UI. It's widely used, so when I get stuck, help is easy to find.

**Vite** for the build tool. It's fast and has almost nothing to configure.

**Supabase** for the backend. It handles authentication, the database, and access control in one service. The database is Postgres, so my data isn't locked into a proprietary format. Access rules are enforced at the database level using row-level security.

**Cloudflare Pages** for hosting. The free tier is generous, every push to GitHub auto-deploys, and it's fast worldwide.

Fewer moving parts, fewer things to break, less to maintain.

### Did you use AI to build this?

Yes. AI made it realistic for me to ship something working in a reasonable amount of time. Every design decision in this app is mine. The code that implements them was written with help.

## Contact

For bugs or feature ideas: hello [at] grampacker [dot] app.
