# About grampacker

I built grampacker for myself. I was keeping my gear and packing lists in spreadsheets but I wanted a better tool. I tried other apps and ran into different limits. So I built the tool I wanted.

I'm sharing it in case it's useful to you too. It's free to use.

This is a personal project. No company, no roadmap committee, no ads, no data harvesting. You sign in with an email and password. Your gear, your lists, and the URLs you choose to share are yours. I'll keep it running and maintained as long as I can.

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

For bugs or feature ideas: hello [at] grampacker [dot] app.
