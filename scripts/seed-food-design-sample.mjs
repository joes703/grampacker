// Developer/owner smoke-test seed: loads the Claude Design "Wind River high
// route" sample Food Plan into ONE existing list you name. This is NOT a general
// food-plan import feature and adds no production UI - it exists so the Food Plan
// screen can be reviewed against realistic data.
//
// Run:  npm run seed:food-design -- --list-id <uuid> [--replace]
//
// Auth: signs in with the anon key as the LIST OWNER (so Row-Level Security stays
// a hard backstop - the script can only ever write the signed-in user's own
// rows). Required env (from .env / .env.local or the shell):
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
//   SEED_USER_EMAIL, SEED_USER_PASSWORD   (fallback: TEST_USER_EMAIL/PASSWORD)
//
// Safety: requires an explicit --list-id; verifies the list exists and is owned
// by the signed-in account; refuses if the list already has a food plan unless
// --replace is passed; --replace deletes ONLY `food_plans` for that list (the
// cascade clears meals/days/day_meals/entries/targets/pack_state and nothing
// else). Never touches gear_items, list_items, lists, or share state, and never
// writes food_pack_state.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { argv, cwd, env, exit } from 'node:process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import * as data from './food-design-sample-data.mjs'
import { buildSeedPlan } from './food-design-sample-map.mjs'

// --- tiny .env reader (no dotenv dependency) -------------------------------
function parseEnvFile(name) {
  try {
    const text = readFileSync(resolve(cwd(), name), 'utf8')
    const out = {}
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
    return out
  } catch {
    return {}
  }
}
const fileEnv = { ...parseEnvFile('.env'), ...parseEnvFile('.env.local') }
const getEnv = (name) => env[name] ?? fileEnv[name]

function fail(message) {
  console.error(`\nerror: ${message}\n`)
  exit(1)
}

// --- args ------------------------------------------------------------------
function parseArgs(rawArgs) {
  let listId = null
  let replace = false
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]
    if (arg === '--replace') replace = true
    else if (arg === '--list-id') { listId = rawArgs[i + 1] ?? null; i += 1 }
    else if (arg.startsWith('--list-id=')) listId = arg.slice('--list-id='.length)
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run seed:food-design -- --list-id <uuid> [--replace]')
      exit(0)
    } else fail(`unknown argument: ${arg}`)
  }
  return { listId, replace }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function insertRows(supabase, table, rows) {
  if (rows.length === 0) return 0
  const { error } = await supabase.from(table).insert(rows)
  if (error) throw new Error(`insert into ${table} failed: ${error.message}`)
  return rows.length
}

async function main() {
  const { listId, replace } = parseArgs(argv.slice(2))
  if (!listId) fail('--list-id <uuid> is required')
  if (!UUID_RE.test(listId)) fail(`--list-id is not a uuid: ${listId}`)

  const url = getEnv('VITE_SUPABASE_URL')
  const anonKey = getEnv('VITE_SUPABASE_ANON_KEY')
  const email = getEnv('SEED_USER_EMAIL') ?? getEnv('TEST_USER_EMAIL')
  const password = getEnv('SEED_USER_PASSWORD') ?? getEnv('TEST_USER_PASSWORD')
  if (!url || !anonKey) fail('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (.env or shell)')
  if (!email || !password) fail('SEED_USER_EMAIL and SEED_USER_PASSWORD must be set (or TEST_USER_EMAIL/PASSWORD)')

  const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // --- sign in as the list owner ------------------------------------------
  const { data: auth, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
  if (signInError || !auth?.user) fail(`sign-in failed for ${email}: ${signInError?.message ?? 'no session'}`)
  const userId = auth.user.id
  console.log(`Signed in as ${email}`)

  // --- verify the list exists and is owned --------------------------------
  const { data: list, error: listError } = await supabase
    .from('lists').select('id, user_id, name').eq('id', listId).maybeSingle()
  if (listError) fail(`could not read list: ${listError.message}`)
  if (!list) fail(`list ${listId} not found (or not owned by ${email})`)
  if (list.user_id !== userId) fail('refusing: that list is not owned by the signed-in account')
  console.log(`Target list: "${list.name}" (${listId})`)

  // --- refuse / replace existing plan -------------------------------------
  const { data: existingPlan, error: planLookupError } = await supabase
    .from('food_plans').select('id').eq('list_id', listId).maybeSingle()
  if (planLookupError) fail(`could not check for an existing food plan: ${planLookupError.message}`)
  if (existingPlan) {
    if (!replace) {
      fail('this list already has a food plan. Re-run with --replace to overwrite it ' +
        '(deletes ONLY this list\'s food plan; gear and list items are untouched).')
    }
    const { error: deleteError } = await supabase
      .from('food_plans').delete().eq('list_id', listId).eq('user_id', userId)
    if (deleteError) fail(`could not delete the existing food plan: ${deleteError.message}`)
    console.log('Replaced: deleted the existing food plan (cascade) for this list.')
  }

  // --- build payloads (pure) ----------------------------------------------
  const { data: existingFoods, error: foodsError } = await supabase
    .from('food_items').select('id, name, brand, sort_order').eq('user_id', userId)
  if (foodsError) fail(`could not read the food library: ${foodsError.message}`)
  const plan = buildSeedPlan({ data, userId, listId, genId: randomUUID, existingFoods: existingFoods ?? [] })

  // --- insert in dependency order, with best-effort cleanup ---------------
  let planInserted = false
  try {
    const createdFoods = await insertRows(supabase, 'food_items', plan.foodItemsToInsert)
    await insertRows(supabase, 'food_plans', [plan.foodPlan]); planInserted = true
    await insertRows(supabase, 'meals', plan.meals)
    await insertRows(supabase, 'food_plan_days', plan.days)
    await insertRows(supabase, 'day_meals', plan.dayMeals)
    await insertRows(supabase, 'food_plan_entries', plan.entries)
    await insertRows(supabase, 'food_plan_daily_targets', plan.dailyTargets)
    await insertRows(supabase, 'meal_targets', plan.mealTargets)

    const dayEntries = plan.entries.filter((e) => !e.is_extra).length
    const extraEntries = plan.entries.length - dayEntries
    console.log('\nSeed complete:')
    console.log(`  foods:         ${createdFoods} created, ${plan.reusedFoodCount} reused`)
    console.log(`  meals:         ${plan.meals.length}`)
    console.log(`  days:          ${plan.days.length}`)
    console.log(`  day_meals:     ${plan.dayMeals.length}`)
    console.log(`  entries:       ${plan.entries.length} (${dayEntries} in meals, ${extraEntries} extras)`)
    console.log(`  daily targets: ${plan.dailyTargets.length}`)
    console.log(`  meal targets:  ${plan.mealTargets.length}`)
    console.log(`\nOpen the Food Plan tab for "${list.name}" to review.`)
  } catch (err) {
    if (planInserted) {
      // Never leave a half-seeded plan: delete the plan we just created (cascade).
      await supabase.from('food_plans').delete().eq('id', plan.foodPlan.id).eq('user_id', userId)
      console.error('Rolled back the partially-seeded food plan.')
    }
    throw err
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
