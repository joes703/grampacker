# Smoke-test: build a useful Food Plan

The throwaway "test" food plan that gets created during development is usually
just a named plan with empty meals, which is useless for reviewing the Food Plan
UI. This recipe builds a realistic plan by hand from the bundled sample food
library, so a reviewer sees populated stat cards, an all-days summary with real
numbers, and day / meal / entry rows.

**There is no general food-plan import, and adding one is intentionally out of
scope.** Only the Food **Library** has a CSV import. Two ways to get a realistic
plan: a one-command dev seed (Option A, fastest, needs your account login), or
build it by hand from the imported sample library (Option B, no credentials).
(Importing a whole plan - days, meals, scheduled entries, targets - is a separate,
unbuilt feature; the seed below is a throwaway developer tool, not that feature.)

## Option A - one-command seed (fastest)

`npm run seed:food-design` loads the entire Claude Design "Wind River high route"
sample (22 foods, 5 meals, a 7-day schedule with all entries, 3 extras, and daily
+ meal targets) into one existing list you name. It is a **developer/owner
smoke-test seed, not a general import feature**, and adds no production UI.

**Run it:**

```
npm run seed:food-design -- --list-id <list-uuid>
# overwrite an existing plan on that list (deletes ONLY that plan):
npm run seed:food-design -- --list-id <list-uuid> --replace
```

Get `<list-uuid>` from the list's URL (`/lists/<uuid>`) or `/lists/<uuid>/food`.

**Required env** (read from `.env` / `.env.local` or the shell - see
`.env.example`):

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` - the same publishable values the
  app uses (no service-role/secret key is involved).
- `SEED_USER_EMAIL`, `SEED_USER_PASSWORD` - the account that **owns** the target
  list (falls back to `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`).

**Safety behavior:**

- The script signs in with the publishable key as the owner, so Row-Level
  Security stays a hard backstop - it can only ever write that user's own rows.
- Requires an explicit `--list-id`; verifies the list exists and is owned by the
  signed-in account.
- Refuses to run if the list already has a food plan unless `--replace` is passed.
  `--replace` deletes **only** `food_plans` for that list; the cascade clears its
  meals / days / entries / targets, and nothing else. It never touches gear items,
  list items, the list itself, or share state, and never writes packed state.
- Re-runs reuse matching library foods by name + brand instead of cloning them.
- Unknown nutrition stays blank (Instant coffee macros, Fruit leather) and a
  measured zero stays zero (Olive oil sodium); the package and by-weight bases are
  both represented.

It prints a summary (foods created/reused, meals, days, entries, targets). Then
**open the Food tab for that list** and review against "What you should see" below.

## Option B - build it by hand (no credentials)

### 1. Import the sample food library

1. Open **Food Library** (`/food`).
2. Open the **CSV format** help affordance and click **Download sample CSV**
   (saves `food-library-sample.csv`). This file is generated from
   `FOOD_SAMPLE_CSV` (`src/lib/csv/food.ts`) and is the full Claude Design trip
   library - 21 foods that deliberately mix packaged foods, by-weight foods (no
   `servings_per_package`), foods with genuinely-unknown macros (Instant coffee,
   Fruit leather - left blank, never 0), and a measured zero (Olive oil sodium).
3. Import that file through the Food Library CSV import. Every row should preview
   as valid; confirm the import.

You now have foods including Instant oatmeal, Instant coffee, Powdered milk, Meal
bar, Energy bar (Clif), Trail mix, Peanut butter packet, Beef stroganoff, Pasta
side, Olive oil, Flour tortilla, Summer sausage, Cheddar cheese, Tuna packet,
Dehydrated refried beans, Chocolate bar, Energy waffle, Peanut candies,
Electrolyte mix, Fruit leather, Dark chocolate, and an Emergency ration bar.

### 2. Create the plan

1. Open a gear list, go to its **Food** tab, and start a food plan.
2. Set the schedule to **5-7 days** (use Edit schedule / Add day).
3. Use the meals **Breakfast / On-trail food / Dinner**. Breakfast and Dinner are
   the anchors that make a day count as "full"; On-trail food holds the day's
   snacks. (Add "On-trail food" with Add meal if it is not already present.)

### 3. Populate representative days

Add enough that the summary has real numbers and at least one full vs partial
day. These two days mirror the design sample:

**Day 1 - arrive midday, so a partial day (omit Breakfast for this day):**
- On-trail food: Energy bar (Clif) x1, Trail mix 60 g (by weight), Flour tortilla
  x2, Summer sausage 56 g, Cheddar cheese 56 g
- Dinner: Beef stroganoff x1 package, Olive oil x1

**Day 2 - a full day:**
- Breakfast: Instant oatmeal x2, Instant coffee x1, Powdered milk x1
- On-trail food: Meal bar x1, Energy waffle x2, Electrolyte mix x1, Flour
  tortilla x2, Tuna packet x1 package, Peanut butter packet x1
- Dinner: Pasta side x1 package, Olive oil x1, Tuna packet x1

This exercises all three entry bases (servings, packages, weight) and includes a
food with unknown macros (Instant coffee), so the summary's "incomplete" markers
show up.

### 4. Add Extras

Extras are packed-but-unscheduled food (not tied to a day or meal). Add:
Emergency ration bar x1, Electrolyte mix x2, Instant coffee x2. They count toward
Packed total but not toward the Planned total or the Full-day average.

## What you should see

- **Stat strip:** a real Packed food weight, a Full-day-average kcal with an "N
  of M days counted" denominator, and a calorie density.
- **All-days summary:** Planned total / Full-day average / Packed total reconcile,
  with a Partial pill on Day 1 and an incomplete marker wherever Instant coffee
  contributes to a macro it does not report.
- **Day document:** Breakfast / On-trail food / Dinner sections with entry rows.
