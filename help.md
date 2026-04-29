# How to use grampacker

## Two ways to start

**If you're coming from Lighterpack**, you can export your data as CSV from Lighterpack and import it here. grampacker reads the standard Lighterpack CSV format, so your items, weights, categories, and worn/consumable flags come over with you.

**If you're starting fresh**, you can build up your gear inventory first, or just start a list and add items as you go. Either works.

## Concepts

### Inventory and lists

Your gear inventory is your library. Every item you own lives there once. A list is a packing list for a specific trip, built from items in your inventory. They're the same items in two views, so changes you make in one place show up in the other.

### Worn, consumable, and base weight

Every item in a list is one of three types:

- **Base** is gear that goes in your pack. The default for most things.
- **Consumable** items are food, fuel, and water. Tracked separately because they start full and end empty.
- **Worn** items are on your body when you're walking, like boots or trekking poles. They're not in your pack, so they aren't counted in pack totals.

Each list shows two totals:

- **Base weight** is the sum of your base items. The number most people optimize.
- **Total pack weight** is base plus consumables. What's actually on your back at the trailhead.

### Categories

You define your own categories. There's no fixed list. Type a category name that doesn't exist and it's created.

## How to

### Building a list

The gear picker panel on the left is the easiest way to add items, assuming your inventory is already populated. It shows your full inventory. Click an item to add it to the list. Click it again to remove it. No drag-and-drop, just clicks.

You can also add items as you go. Type an item name that isn't in your inventory and you've added it to both the list and the inventory at the same time. Type a category name that doesn't exist and you've made a new category.

### Editing and organizing a list

You can click an item's name, description, or weight to edit it inline. Changes save automatically and update the inventory.

You can drag any row up or down to reorder it within its category. Drag it into a different category to move it across.

### Sharing a list

The globe icon at the top of a list toggles public sharing on or off. When it's on, a public URL appears and you can copy it. When it's off, the URL stops working.

Anyone with the URL can view the list. They can't edit it, and they don't need an account.

### Packing mode

Packing mode is a stripped-down view of a list with one purpose: helping you pack. You see your items, you check them off as they go in the bag.

It's intentionally sparse. No editing, no breakdowns, no extra panels. When you're standing over a half-packed bag the night before a 5am drive, you don't want to be navigating a UI.

If you need to change something, exit packing mode back to the list view.

### Managing the gear inventory

The inventory has its own **Manage** mode for working on your gear directly, especially in bulk.

In Manage mode you can:

- Edit any item's name, description, weight, or category inline
- Select one item, or many at once
- Move the selected items to a different category
- Delete the selected items
- Create a new list from the selected items

You can use it to clean up after a CSV import, reorganize categories, or build a list from items you've already picked out.

### Exporting and deleting

You can download your full gear inventory and all your lists as a single zip file in one click. You can delete your account at any time. Both options are in account settings, no friction either way.

## FAQ

### Why a separate gear inventory?

Your inventory is the source of truth for everything you own. Each item lives there once, with one weight. Lists are built from inventory, and edits flow both ways. The inventory has its own Manage mode for bulk work: multi-select, move categories, delete, or turn a selection into a new list.

### Why does editing a list item change the inventory?

Because most edits are real corrections. I weighed it more accurately, I added a note, I fixed the brand name. Those changes should stick across every list.

When you actually want a one-off, like a borrowed item or a substitute for one trip, you can create a new item instead. The coupling is intentional.

### Why these specific weight totals?

Every item is base, consumable, or worn.

- **Base** is gear that goes in your pack.
- **Consumables** are food, fuel, and water. They start full and end empty.
- **Worn** items are on your body when you start walking, like boots and trekking poles.

The total I show is **base + consumables**. That's what's actually on your back at the trailhead. Worn items count toward what you're carrying overall, but they're not in your pack, so they don't belong in pack weight.

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
