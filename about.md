# About grampacker

I built grampacker for myself. I was keeping my gear and packing lists in spreadsheets but I wanted a better tool. I tried other apps and ran into different limits. So I built the tool I wanted.

I'm sharing it in case it's useful to you too. It's free to use.

This is a personal project. No company, no roadmap committee, no ads, no data harvesting. You sign in with an email and password. Your gear, your lists, and the URLs you choose to share are yours. I'll keep it running and maintained as long as I can.

## Why a separate gear inventory?

Your inventory is the source of truth for everything you own. Each item lives there once, with one weight. Lists are built from inventory, and edits flow both ways. The inventory has its own Manage mode for bulk work: multi-select, move categories, delete, or turn a selection into a new list.

## Why does editing a list item change the inventory?

Because most edits are real corrections. I weighed it more accurately, I added a note, I fixed the brand name. Those changes should stick across every list.

When you actually want a one-off, like a borrowed item or a substitute for one trip, you can create a new item instead. The coupling is intentional.

## Why these specific weight totals?

Every item is base, consumable, or worn.

- **Base** is gear that goes in your pack.
- **Consumables** are food, fuel, and water. They start full and end empty.
- **Worn** items are on your body when you start walking, like boots and trekking poles.

The total I show is **base + consumables**. That's what's actually on your back at the trailhead. Worn items count toward what you're carrying overall, but they're not in your pack, so they don't belong in pack weight.

## Why can't I drag from the picker?

Drag-and-drop is good for moving things you've already placed. It's slower than a click when you're picking from a long list. Inside a list, drag sorts and re-categorizes. From the picker, click adds and click again removes.

## Why no images?

Storage costs scale with users in a way I can't sustain for free. Hosting user-uploaded images also means moderating content, which I don't want to do.

## Why does grampacker work like an app on my phone?

grampacker is a Progressive Web App, or PWA. A PWA is a website you can add to your home screen so it behaves like an installed app. No app store, no install. I use packing mode on my phone often, and I wanted that to work well without anyone having to download a native app.

## What's the tech stack and why?

**TypeScript** for the language. It adds types to JavaScript. The editor flags mistakes before I run the code, and the types serve as documentation when I come back to a file weeks later.

**React** for the UI. It's widely used, so when I get stuck, help is easy to find.

**Vite** for the build tool. It's fast and has almost nothing to configure.

**Supabase** for the backend. It handles authentication, the database, and access control in one service. The database is Postgres, so my data isn't locked into a proprietary format. Access rules are enforced at the database level using row-level security.

**Cloudflare Pages** for hosting. The free tier is generous, every push to GitHub auto-deploys, and it's fast worldwide.

Fewer moving parts, fewer things to break, less to maintain.

## Did you use AI to build this?

Yes. AI made it realistic for me to ship something working in a reasonable amount of time. Every design decision in this app is mine. The code that implements them was written with help.

## Contact

For bugs or feature ideas: hello@grampacker.app.
