# Food Plan design-prototype (throwaway)

## The question this answers

> After ~50 micro-PRs of token/copy polish, the shipped Food Plan screen still
> does not read like the approved Claude Design "Approach D" (Field journal +
> review tools) prototype. **Composed side by side at full screen, how far is the
> current direction from the approved design, and what concretely has to change
> before we rewrite production?**

The prototype reconstructs the *whole* populated screen from the archive's own
sample data so the gap is visible at a glance instead of being argued one delta
at a time.

## How to view it

Open any of your lists in the running app and append the query param:

```
/lists/<any-list-id>/food?variant=design-prototype
```

It renders read-only inside the real app shell (global nav stays real; the
workspace header + tabs + document are reproduced). No param -> the normal
production Food Plan UI, unchanged.

## What it is / isn't

- **Is:** a faithful desktop reproduction of `fp/approach-d.jsx` + `plan-frame`,
  `plan-bits`, `summary`, `parts`, and the `_ds` chrome, driven by the archive's
  7-day Wind River fixture (`fp/data.jsx`). Inline styles + the archive's own CSS
  tokens, scoped to `.fp-design-prototype`.
- **Isn't:** production code. No persistence, no Supabase, no queries, no
  mutations. Interactive bits are in-memory view state only (unit g/oz, day
  collapse, summary "more metrics", click-a-day-to-scroll). Every edit / add /
  share / review / kebab affordance is a static visual that does nothing.

## Intentional deviations from the archive

- ASCII separators (`-`) instead of the design's middot (`·`), per the repo's
  no-non-ASCII-punctuation rule. The shipped app already made this choice.
- Desktop composition only (the archive also defines a mobile variant).
- The per-day nutrition **review side panel** (`DReview`) and all editor modals
  (schedule / meals / targets / qty / picker) are out of scope: Review and the
  toolbar editors render as affordances but open nothing. The default populated
  screen does not show the review panel anyway.

## Verdict (fill in after visual review)

- [ ] Approved direction — fold into production via the staged PRs.
- [ ] Needs changes before production: _..._

Once the decision is captured, delete `src/food/__design-prototype__/` and remove
the `?variant=design-prototype` gate from `FoodPlanPage.tsx`.
