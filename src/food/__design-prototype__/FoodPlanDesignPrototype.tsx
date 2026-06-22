// ============================================================================
// THROWAWAY DESIGN-PROTOTYPE: populated Food Plan screen (Approach D)
//
// A read-only visual-parity reproduction of the approved Claude Design
// "Field journal + review tools" populated Food Plan screen, rendered inside
// the real app shell at /lists/:id/food?variant=design-prototype.
//
// Ported (desktop composition) from:
//   docs/design/Grampacker Food Planning/fp/{approach-d,plan-frame,plan-bits,
//   summary,parts,shell}.jsx + _ds bundle chrome (StatStrip, ListTabs,
//   SegmentedControl, Button, DraftBadge).
//
// Deliberately NOT production: inline styles + archive CSS tokens scoped to
// `.fp-design-prototype`, fixture data, no persistence, no queries, no
// mutations. Interactive bits (unit toggle, day collapse, "more metrics") are
// in-memory view state only. Edit/add/share/review affordances are rendered as
// static visuals and intentionally do nothing. Delete this whole folder once
// the composition is folded into the real UI. See NOTES.md.
// ============================================================================
import { useState, useContext, createContext, type ReactNode, type CSSProperties } from 'react'
import {
  Table, ChevronUp, ChevronDown, ChevronRight, Activity, EllipsisVertical, Lock, Plus, Minus,
  UserPen, PackagePlus, Info, CalendarCog, UtensilsCrossed, Target, CalendarDays, Pencil,
  GripVertical, Sparkles, TriangleAlert, CircleAlert, MousePointerClick, Share2, Settings2,
  Package, PackageCheck, Utensils, type LucideIcon,
} from 'lucide-react'
import {
  type WeightUnit, type MetricKey, type Entry, type Day, type Meal, type Metric,
  DAYS, EXTRAS, DAILY_TARGETS, PLAN,
  food, basisLabel, effServings, entryWeightG, totalWeightG, aggregate, computeMetric,
  dayEntries, mealsOnDay, omittedMeals, planDayEntries, allEntries, fullDayEntries, fullDays,
  isFullDay, missingAnchors, scheduleCounts, fmtWeightG, fmtNum, fmtMetric, metricUnit,
} from './data'

// ---- design tokens, scoped to the prototype root ---------------------------
// Copied verbatim from the archive `_ds/.../tokens/*.css`, scoped so they never
// leak into the production app. The ported inline styles below resolve against
// these `var(--*)` references.
const TOKENS_CSS = `
.fp-design-prototype{
  --gray-50:#f9fafb; --gray-100:#f3f4f6; --gray-200:#e5e7eb; --gray-300:#d1d5db;
  --gray-400:#9ca3af; --gray-500:#6b7280; --gray-600:#4b5563; --gray-700:#374151;
  --gray-800:#1f2937; --gray-900:#111827; --white:#ffffff;
  --blue-50:#eff6ff; --blue-100:#dbeafe; --blue-300:#93c5fd; --blue-500:#3b82f6;
  --blue-600:#2563eb; --blue-700:#1d4ed8;
  --green-50:#f0fdf4; --green-200:#bbf7d0; --green-500:#22c55e; --green-600:#16a34a;
  --amber-50:#fffbeb; --amber-100:#fef3c7; --amber-200:#fde68a; --amber-500:#f59e0b; --amber-800:#92400e;

  --app-bg:var(--gray-50); --surface:var(--white); --surface-header:var(--gray-50);
  --surface-selected:var(--blue-50); --surface-hover:var(--gray-50);
  --border:var(--gray-200); --border-strong:var(--gray-200); --divider:var(--gray-100);
  --border-input:var(--gray-300);
  --text-primary:var(--gray-900); --text-heading:var(--gray-700); --text-secondary:var(--gray-600);
  --text-muted:var(--gray-500); --text-faint:var(--gray-400); --text-on-accent:var(--white);
  --action:var(--blue-600); --action-hover:var(--blue-700); --action-soft-bg:var(--blue-50);
  --action-soft-border:var(--blue-300); --action-soft-text:var(--blue-700);
  --success:var(--green-600); --success-bar:var(--green-500);
  --danger:#dc2626; --danger-bg:#fef2f2;
  --draft-bg:var(--amber-100); --draft-text:var(--amber-800);
  --needs-repair-bg:var(--amber-50); --needs-repair-text:var(--amber-800); --needs-repair-ring:var(--amber-200);

  --radius-sm:0.25rem; --radius-md:0.375rem; --radius-lg:0.5rem; --radius-xl:0.75rem; --radius-full:9999px;
  --text-2xl:1.5rem; --text-xl:1.25rem; --text-lg:1.125rem; --text-base:1rem; --text-sm:0.875rem;
  --text-13:0.8125rem; --text-xs:0.75rem;
  --weight-normal:400; --weight-medium:500; --weight-semibold:600; --weight-bold:700;
  --tracking-wider:0.05em;
  --font-sans:ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono:ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}`

// ---- unit (g/oz) shared across the read-only tree --------------------------
const UnitContext = createContext<WeightUnit>('oz')
const useUnit = () => useContext(UnitContext)

// ---- icon wrapper (maps archive lucide names to lucide-react) --------------
const ICONS: Record<string, LucideIcon> = {
  table: Table, 'chevron-up': ChevronUp, 'chevron-down': ChevronDown, 'chevron-right': ChevronRight,
  activity: Activity, 'ellipsis-vertical': EllipsisVertical, lock: Lock, plus: Plus, minus: Minus,
  'user-pen': UserPen, 'package-plus': PackagePlus, info: Info, 'calendar-cog': CalendarCog,
  'utensils-crossed': UtensilsCrossed, target: Target, 'calendar-days': CalendarDays, pencil: Pencil,
  'grip-vertical': GripVertical, sparkles: Sparkles, 'triangle-alert': TriangleAlert,
  'circle-alert': CircleAlert, 'mouse-pointer-click': MousePointerClick, 'share-2': Share2,
  'settings-2': Settings2, package: Package, 'package-check': PackageCheck, utensils: Utensils,
}
function Icon({ name, size = 16, color, style }: { name: string; size?: number; color?: string; style?: CSSProperties }) {
  const Cmp = ICONS[name]
  if (!Cmp) return null
  return <Cmp size={size} color={color} aria-hidden="true" style={{ flexShrink: 0, ...style }} />
}

// ---- tiny text primitives --------------------------------------------------
function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)', ...style }}>
      {children}
    </span>
  )
}
function Mono({ children, color, size = 'var(--text-xs)', style }: { children: ReactNode; color?: string; size?: string; style?: CSSProperties }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: size, color: color || 'var(--text-primary)', ...style }}>
      {children}
    </span>
  )
}

// ---- design-system chrome (faithful to the archive bundle) -----------------
type Stat = { label: string; value: ReactNode }
function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden' }}>
      {stats.map((s, i) => (
        <div key={s.label} style={{ padding: '8px 12px', textAlign: 'center', borderLeft: i === 0 ? 'none' : '1px solid var(--divider)' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-muted)' }}>{s.label}</p>
          <p style={{ margin: '2px 0 0', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-xs)', color: 'var(--text-primary)' }}>{s.value}</p>
        </div>
      ))}
    </div>
  )
}

function SegmentedControl({ options, value, onChange, ariaLabel }: { options: { value: WeightUnit; label: string }[]; value: WeightUnit; onChange: (v: WeightUnit) => void; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: 'inline-grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', gap: 2, padding: 2, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-input)', background: 'var(--surface)' }}>
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button key={opt.value} type="button" role="radio" aria-checked={selected} onClick={() => onChange(opt.value)}
            style={{ minWidth: 36, padding: '4px 8px', textAlign: 'center', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', lineHeight: 1.2, border: 'none', borderRadius: 'var(--radius-sm)', background: selected ? 'var(--action)' : 'transparent', color: selected ? 'var(--text-on-accent)' : 'var(--text-secondary)', cursor: 'pointer' }}>
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// Secondary, sm button used across the toolbar / header (non-functional here).
function ToolButton({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 12px', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', lineHeight: 1.2, borderRadius: 'var(--radius-lg)', background: 'var(--surface)', color: 'var(--text-heading)', border: '1px solid var(--border-input)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {icon}{children}
    </button>
  )
}

function DraftBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--draft-bg)', color: 'var(--draft-text)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', whiteSpace: 'nowrap' }}>Draft</span>
  )
}

// ---- nutrition display -----------------------------------------------------
type TargetStatus = 'ok' | 'under' | 'over' | 'na' | 'off'
function evalTarget(t: { mode: string; value?: number; min?: number; max?: number } | null, value: number, complete: boolean): TargetStatus {
  if (!t || t.mode === 'off') return 'off'
  if (!complete) return 'na'
  if (t.mode === 'floor') return value < (t.value ?? 0) ? 'under' : 'ok'
  if (t.mode === 'ceiling') return value > (t.value ?? 0) ? 'over' : 'ok'
  if (t.mode === 'band') return value < (t.min ?? 0) ? 'under' : value > (t.max ?? Infinity) ? 'over' : 'ok'
  return 'ok'
}
function TargetDot({ status }: { status: TargetStatus }) {
  if (status === 'off' || status === 'na') return null
  const c = status === 'ok' ? 'var(--success-bar)' : 'var(--amber-500)'
  return <span aria-hidden="true" title={status === 'ok' ? 'On target' : status === 'under' ? 'Below target' : 'Above target'} style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: c, marginLeft: 5, verticalAlign: 'middle' }} />
}

// Honest incomplete pill - never a partial subtotal shown as the total.
function Incomplete({ compact }: { missing: string[]; compact?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--needs-repair-text)', background: 'var(--needs-repair-bg)', border: '1px solid var(--needs-repair-ring)', borderRadius: 'var(--radius-full)', padding: '1px 7px', whiteSpace: 'nowrap' }}>
      <Icon name="circle-alert" size={11} />
      {compact ? 'Incomplete' : 'Incomplete'}
    </span>
  )
}
// Compact incomplete marker for dense table cells: dash-free alert + count.
function IncompleteMark({ missing }: { missing: string[] }) {
  const n = missing.length
  const label = `Missing data: ${n} contributing food${n !== 1 ? 's' : ''} lack${n === 1 ? 's' : ''} this nutrient${n ? ': ' + missing.join(', ') : ''}. No total shown.`
  return (
    <span role="img" aria-label={label} title={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Icon name="triangle-alert" size={12} color="var(--needs-repair-text)" />
      {n > 0 && <span aria-hidden="true" style={{ fontSize: 10, fontWeight: 'var(--weight-semibold)', color: 'var(--needs-repair-text)', fontFamily: 'var(--font-mono)' }}>{n}</span>}
    </span>
  )
}

function MetricValue({ entries, mkey, size }: { entries: Entry[]; mkey: MetricKey; size?: string }) {
  const unit = useUnit()
  const m = computeMetric(entries, mkey, unit)
  if (!m.complete) return <Incomplete missing={m.missing} compact />
  const u = metricUnit(mkey, unit)
  return <Mono size={size} color="var(--text-primary)">{fmtMetric(mkey, m.value)}{u ? <span style={{ color: 'var(--text-faint)' }}> {u}</span> : null}</Mono>
}

// One compact metric chip used in day footers. For calories the unit IS the label.
function MetricChip({ label, entries, mkey }: { label: string; entries: Entry[]; mkey: MetricKey }) {
  const unit = useUnit()
  const m = computeMetric(entries, mkey, unit)
  const u = metricUnit(mkey, unit)
  const showLabel = label && mkey !== 'cal'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
      {showLabel ? <Eyebrow style={{ fontSize: 10 }}>{label}</Eyebrow> : null}
      {m.complete
        ? <Mono>{fmtMetric(mkey, m.value)}{u ? <span style={{ color: 'var(--text-faint)' }}> {u}</span> : null}</Mono>
        : <Incomplete missing={m.missing} compact />}
    </span>
  )
}

// ---- headline stat strip ---------------------------------------------------
function PlanStats() {
  const unit = useUnit()
  const packed = allEntries()
  const calAgg = aggregate(fullDayEntries(), 'cal')
  const fullCount = fullDays().length
  const totalDays = DAYS.length
  const avg = calAgg.complete && fullCount ? Math.round(calAgg.value / fullCount) : null
  const stats: Stat[] = [
    { label: 'Packed food', value: <Mono color="var(--text-primary)" size="var(--text-base)">{fmtWeightG(totalWeightG(packed), unit)}</Mono> },
    {
      label: 'Full-day average',
      value: avg != null
        ? (
          <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>
            <Mono color="var(--text-primary)" size="var(--text-base)">{fmtNum(avg)}<span style={{ color: 'var(--text-faint)', fontSize: 'var(--text-xs)' }}> kcal</span></Mono>
            <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 10, letterSpacing: 0, textTransform: 'none', color: 'var(--text-faint)' }}>{fullCount} of {totalDays} days counted</span>
          </span>
        )
        : <Incomplete missing={calAgg.missing} compact />,
    },
    { label: 'Calorie density', value: <MetricValue entries={packed} mkey="density" size="var(--text-base)" /> },
  ]
  return <StatStrip stats={stats} />
}

// ---- plan tools (unit toggle + non-functional editors) ---------------------
function PlanTools({ unit, onUnit }: { unit: WeightUnit; onUnit: (u: WeightUnit) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <SegmentedControl options={[{ value: 'oz', label: 'oz' }, { value: 'g', label: 'g' }]} value={unit} onChange={onUnit} ariaLabel="Weight unit" />
      <ToolButton icon={<Icon name="calendar-cog" size={14} />}>Edit schedule</ToolButton>
      <ToolButton icon={<Icon name="utensils-crossed" size={14} />}>Customize Meals</ToolButton>
      <ToolButton icon={<Icon name="target" size={14} />}>Targets</ToolButton>
    </div>
  )
}

// ---- quiet schedule-context line -------------------------------------------
function ScheduleLine() {
  const sc = scheduleCounts()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)' }}>
      <Icon name="calendar-days" size={15} color="var(--text-muted)" />
      <span style={{ fontSize: 'var(--text-13)', color: 'var(--text-heading)', fontWeight: 'var(--weight-medium)' }}>{sc.days} days - {sc.total} planned Meals</span>
      <span style={{ height: 14, width: 1, background: 'var(--border)' }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: '2px 10px', flexWrap: 'wrap', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
        {sc.per.map((m) => (
          <span key={m.id} style={{ whiteSpace: 'nowrap' }}>{m.name} <Mono color="var(--text-secondary)">{m.count}</Mono>{m.custom && <span style={{ color: 'var(--text-faint)' }}> - custom</span>}</span>
        ))}
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>{sc.fullDays} full {sc.fullDays === 1 ? 'day' : 'days'}</span>
        <button type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--action)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)' }}>
          <Icon name="pencil" size={12} /> Edit schedule
        </button>
      </span>
    </div>
  )
}

// ---- all-days summary (collapsible) + table --------------------------------
const SUM_COLS: { key: MetricKey | 'weight'; label: string }[] = [
  { key: 'weight', label: 'Weight' }, { key: 'cal', label: 'kcal' }, { key: 'carbs', label: 'Carbs' },
  { key: 'protein', label: 'Protein' }, { key: 'fat', label: 'Fat' }, { key: 'sodium', label: 'Sodium' },
  { key: 'density', label: 'kcal/oz' },
]
const SUM_MORE: { key: MetricKey | 'weight'; label: string }[] = [
  { key: 'fiber', label: 'Fiber' }, { key: 'sugar', label: 'Sugar' }, { key: 'potassium', label: 'Potass.' },
]
const TH: CSSProperties = { padding: '7px 10px', textAlign: 'right', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)', color: 'var(--text-faint)', whiteSpace: 'nowrap' }
const TD_NUM: CSSProperties = { padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }
const TD_NAME: CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: 'var(--text-13)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }
const DT: Record<string, { mode: string; value?: number; min?: number; max?: number }> = {}
DAILY_TARGETS.forEach((t) => { DT[t.metric] = t })

function cellValue(entries: Entry[], key: MetricKey | 'weight', unit: WeightUnit): Metric {
  if (key === 'weight') return { complete: true, value: totalWeightG(entries), missing: [] }
  return computeMetric(entries, key, unit)
}
function fmtCell(key: MetricKey | 'weight', v: number, unit: WeightUnit): string {
  if (key === 'weight') return fmtWeightG(v, unit)
  if (key === 'density') return (Math.round(v * 10) / 10).toFixed(1)
  return fmtNum(Math.round(v))
}
function dailyStatus(key: MetricKey | 'weight', v: number): TargetStatus | null {
  if (key === 'weight') return null
  const t = DT[key]
  if (!t || t.mode === 'off') return null
  return evalTarget(t, v, true)
}

function scrollToDay(domId: string) {
  const el = document.getElementById(domId)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function SummaryTable() {
  const unit = useUnit()
  const [more, setMore] = useState(false)
  const cols = more ? [...SUM_COLS, ...SUM_MORE] : SUM_COLS
  const planned = planDayEntries()
  const packed = allEntries()
  const fullCount = fullDays().length

  const DayCell = ({ entries, colKey, compare }: { entries: Entry[]; colKey: MetricKey | 'weight'; compare: boolean }) => {
    const m = cellValue(entries, colKey, unit)
    if (!m.complete) return <td style={TD_NUM}><IncompleteMark missing={m.missing} /></td>
    const status = compare ? dailyStatus(colKey, m.value) : null
    return <td style={TD_NUM}><Mono color="var(--text-primary)">{fmtCell(colKey, m.value, unit)}</Mono>{status && <TargetDot status={status} />}</td>
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 12px', background: 'var(--surface-header)', borderBottom: '1px solid var(--divider)' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-heading)' }}>All days</span>
        <span style={{ marginLeft: 'auto' }}>
          <button type="button" onClick={() => setMore((v) => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--action)' }}>
            <Icon name={more ? 'minus' : 'plus'} size={12} /> {more ? 'Fewer metrics' : 'More metrics'}
          </button>
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: more ? 760 : 620 }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={{ ...TH, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--surface)' }}>Day</th>
              {cols.map((c) => <th key={c.key} style={TH}>{c.key === 'density' ? (unit === 'g' ? 'kcal/g' : 'kcal/oz') : c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((d) => {
              const entries = dayEntries(d)
              const empty = entries.length === 0
              const full = isFullDay(d)
              const miss = missingAnchors(d)
              return (
                <tr key={d.n} onClick={() => scrollToDay(`fp-proto-day-${d.n}`)} style={{ borderTop: '1px solid var(--divider)', cursor: 'pointer' }}>
                  <td style={{ ...TD_NAME, position: 'sticky', left: 0, background: 'inherit' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {d.label}{d.note && <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 400 }}>{d.note}</span>}
                      {!full && <span title={miss.length ? `Partial day - you didn't schedule ${miss.join(' or ')} on this day. Not counted in the full-day average or target check.` : 'Partial day - not counted in the full-day average or target check.'} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-muted)', background: 'var(--gray-100)', borderRadius: 'var(--radius-full)', padding: '1px 6px', cursor: 'help' }}>Partial</span>}
                      <Icon name="chevron-right" size={12} color="var(--text-faint)" />
                    </span>
                  </td>
                  {empty
                    ? <td colSpan={cols.length} style={{ ...TD_NUM, textAlign: 'left', color: 'var(--text-faint)', fontStyle: 'italic' }}>Empty day</td>
                    : cols.map((c) => <DayCell key={c.key} entries={entries} colKey={c.key} compare={full} />)}
                </tr>
              )
            })}
            <tr onClick={() => scrollToDay('fp-proto-extras')} style={{ borderTop: '1px solid var(--divider)', background: 'var(--gray-50)', cursor: 'pointer' }}>
              <td style={{ ...TD_NAME, position: 'sticky', left: 0, background: 'inherit' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="package-plus" size={12} color="var(--text-muted)" /> Extras<Icon name="chevron-right" size={12} color="var(--text-faint)" /></span></td>
              {cols.map((c) => { const m = cellValue(EXTRAS, c.key, unit); return m.complete ? <td key={c.key} style={TD_NUM}><Mono color="var(--text-muted)">{fmtCell(c.key, m.value, unit)}</Mono></td> : <td key={c.key} style={TD_NUM}><IncompleteMark missing={m.missing} /></td> })}
            </tr>
            <TotalsRow label="Planned total" hint="sum of days" entries={planned} cols={cols} unit={unit} bold />
            <TotalsRow label="Full-day average" hint={`${fullCount} of ${DAYS.length} days`} entries={fullDayEntries()} cols={cols} unit={unit} divideBy={fullCount || 1} dots />
            <TotalsRow label="Packed total" hint="days + Extras" entries={packed} cols={cols} unit={unit} strong />
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 12px', borderTop: '1px solid var(--divider)', fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success-bar)' }} /> on target</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--amber-500)' }} /> outside target</span>
        <span style={{ color: 'var(--needs-repair-text)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="triangle-alert" size={11} /> = a contributing food is missing that nutrient (no total shown)</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--action)' }}><Icon name="mouse-pointer-click" size={11} /> click a day to jump to it</span>
      </div>
    </div>
  )
}
function TotalsRow({ label, hint, entries, cols, unit, divideBy, bold, strong, dots }: { label: string; hint: string; entries: Entry[]; cols: { key: MetricKey | 'weight'; label: string }[]; unit: WeightUnit; divideBy?: number; bold?: boolean; strong?: boolean; dots?: boolean }) {
  return (
    <tr style={{ borderTop: strong ? '2px solid var(--border-strong)' : '1px solid var(--divider)', background: 'var(--surface)' }}>
      <td style={{ ...TD_NAME, position: 'sticky', left: 0, background: 'var(--surface)', fontWeight: bold || strong ? 'var(--weight-semibold)' : 'var(--weight-medium)' }}>
        {label} <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 400 }}>{hint}</span>
      </td>
      {cols.map((c) => {
        const m = cellValue(entries, c.key, unit)
        if (!m.complete) return <td key={c.key} style={TD_NUM}><IncompleteMark missing={m.missing} /></td>
        let val = m.value
        if (divideBy && c.key !== 'density') val = val / divideBy
        const status = dots ? dailyStatus(c.key, val) : null
        return <td key={c.key} style={TD_NUM}><Mono color={strong || bold ? 'var(--text-primary)' : 'var(--text-secondary)'} style={{ fontWeight: bold || strong ? 600 : 400 }}>{fmtCell(c.key, val, unit)}</Mono>{status && <TargetDot status={status} />}</td>
      })}
    </tr>
  )
}

function AllDaysSummary() {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
        <Icon name="table" size={15} color="var(--text-muted)" />
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>All-days summary</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>per-day totals - Extras - Planned, Average-full-day &amp; Packed reconciliation</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', color: 'var(--action)' }}>
          {open ? 'Hide' : 'Show'} table <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </span>
      </button>
      {open && <div style={{ borderTop: '1px solid var(--divider)', padding: 12 }}><SummaryTable /></div>}
    </div>
  )
}

// ---- entry row + meal divider ----------------------------------------------
const addBtn: CSSProperties = { width: 24, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-input)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', cursor: 'pointer', color: 'var(--action)' }

function EntryRow({ e, last }: { e: Entry; last: boolean }) {
  const unit = useUnit()
  const f = food(e.food)
  const cal = Math.round(f.cal * effServings(e))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, padding: '4px 12px', borderBottom: last ? 'none' : '1px solid var(--divider)', fontSize: 'var(--text-13)' }}>
      <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-faint)' }}><Icon name="grip-vertical" size={13} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{f.name}</span>
      </span>
      <span style={{ padding: '2px 6px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}><Mono color="var(--text-muted)">{basisLabel(e)}</Mono></span>
      <span style={{ width: 54, textAlign: 'right' }}><Mono color="var(--text-faint)">{cal}</Mono></span>
      <span style={{ width: 72, textAlign: 'right' }}><Mono color="var(--text-secondary)">{fmtWeightG(entryWeightG(e), unit)}</Mono></span>
      <span style={{ width: 28, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)', color: 'var(--text-faint)' }}><Icon name="ellipsis-vertical" size={15} /></span>
    </div>
  )
}

function MealDivider({ meal, entries }: { meal: Meal; entries: Entry[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--gray-50)', borderBottom: '1px solid var(--divider)', borderTop: '1px solid var(--divider)' }}>
      <Eyebrow style={{ fontSize: 10 }}>{meal.name}</Eyebrow>
      {meal.custom && <span title="Custom Meal" style={{ display: 'inline-flex' }}><Icon name="sparkles" size={11} color="var(--text-faint)" /></span>}
      <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{entries.length || 'empty'}</span>
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        {entries.length > 0 && <span style={{ fontSize: 'var(--text-xs)' }}><MetricValue entries={entries} mkey="cal" /></span>}
        <button type="button" title="Add food" style={addBtn}><Icon name="plus" size={13} /></button>
      </span>
    </div>
  )
}

// ---- a single flat Day section ---------------------------------------------
function DaySection({ day }: { day: Day }) {
  const unit = useUnit()
  const [open, setOpen] = useState(true)
  const meals = mealsOnDay(day)
  const omitted = omittedMeals(day)
  const dEntries = dayEntries(day)
  const full = isFullDay(day)
  const miss = missingAnchors(day)
  return (
    <div id={`fp-proto-day-${day.n}`} style={{ borderBottom: '1px solid var(--divider)' }}>
      {/* day header strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '0 10px 0 8px', background: 'var(--surface-header)', borderBottom: open ? '1px solid var(--divider)' : 'none' }}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse day' : 'Expand day'} style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: '9px 0', textAlign: 'left' }}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} color="var(--text-muted)" />
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>{day.label}</span>
          {day.note && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>- {day.note}</span>}
          {!full && <span title={miss.length ? `Partial day - you didn't schedule ${miss.join(' or ')} on this day. Excluded from the full-day average and target check.` : 'Partial day - excluded from the full-day average and target check.'} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-muted)', background: 'var(--gray-100)', borderRadius: 'var(--radius-full)', padding: '1px 7px' }}>Partial{day.fullOverride != null && <Icon name="lock" size={9} />}</span>}
          {!open && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>- {dEntries.length} foods</span>}
        </button>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 'var(--text-xs)' }}><MetricChip label="" entries={dEntries} mkey="cal" /></span>
          <Mono color="var(--text-muted)">{fmtWeightG(totalWeightG(dEntries), unit)}</Mono>
          <button type="button" title="Review nutrition" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px', border: '1px solid var(--border-input)', background: 'var(--surface)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)' }}>
            <Icon name="activity" size={13} /><span>Review</span>
          </button>
          <button type="button" aria-label="Day options" style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', cursor: 'pointer' }}><Icon name="ellipsis-vertical" size={15} /></button>
        </span>
      </div>

      {open && (
        <>
          {meals.map((m) => {
            const entries = day.meals[m.id] ?? []
            return (
              <div key={m.id}>
                <MealDivider meal={m} entries={entries} />
                {entries.length === 0
                  ? <button type="button" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 8px 34px', border: 'none', borderBottom: '1px solid var(--divider)', background: 'transparent', cursor: 'pointer', fontSize: 'var(--text-13)', color: 'var(--text-faint)', textAlign: 'left' }}><Icon name="plus" size={13} color="var(--action)" /> Add food</button>
                  : entries.map((e, i) => <EntryRow key={`${m.id}-${i}`} e={e} last={false} />)}
              </div>
            )
          })}
          {omitted.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', background: 'var(--gray-50)', borderBottom: '1px solid var(--divider)' }}>
              <span title="You removed these Meals on this day in the schedule - they aren't a product default." style={{ fontSize: 11, color: 'var(--text-faint)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help' }}><Icon name="user-pen" size={11} /> You removed on {day.label} - tap to add back:</span>
              {omitted.map((m) => <button key={m.id} type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', border: '1px dashed var(--border-input)', borderRadius: 'var(--radius-full)', background: 'transparent', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)' }}><Icon name="plus" size={11} /> {m.name}</button>)}
            </div>
          )}
          {/* compact day footer - metrics + review CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px 16px', flexWrap: 'wrap', padding: '9px 12px' }}>
            <MetricChip label="Cal" entries={dEntries} mkey="cal" />
            <MetricChip label="P" entries={dEntries} mkey="protein" />
            <MetricChip label="C" entries={dEntries} mkey="carbs" />
            <MetricChip label="F" entries={dEntries} mkey="fat" />
            <MetricChip label="Na" entries={dEntries} mkey="sodium" />
            <MetricChip label={unit === 'g' ? 'kcal/g' : 'kcal/oz'} entries={dEntries} mkey="density" />
            <button type="button" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--action)', fontWeight: 'var(--weight-medium)' }}>
              <Icon name="activity" size={13} /> Review nutrition -&gt;
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---- Extras section --------------------------------------------------------
function ExtrasSection() {
  const unit = useUnit()
  return (
    <div id="fp-proto-extras" style={{ borderTop: '2px solid var(--border-strong)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 42, padding: '0 10px 0 12px', background: 'var(--surface-header)', borderBottom: '1px solid var(--divider)' }}>
        <Icon name="package-plus" size={14} color="var(--text-muted)" />
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>Extras</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>extra / emergency - not tied to a day</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mono color="var(--text-muted)">{fmtWeightG(totalWeightG(EXTRAS), unit)}</Mono>
          <button type="button" title="Review nutrition" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px', border: '1px solid var(--border-input)', background: 'var(--surface)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)' }}>
            <Icon name="activity" size={13} /><span>Review</span>
          </button>
          <button type="button" title="Add to Extras" style={addBtn}><Icon name="plus" size={13} /></button>
        </span>
      </div>
      {EXTRAS.map((e, i) => <EntryRow key={`extra-${i}`} e={e} last={i === EXTRAS.length - 1} />)}
      <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-faint)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Icon name="info" size={12} style={{ marginTop: 1 }} />
        <span>Genuinely extra or emergency food - packed but not assigned to any Day or Meal (e.g. a spare ration bar). It counts toward packed weight and trip nutrition, but never toward a single day's totals or the full-day average. Planning ordinary meals? Add them to the Day sections above, not here.</span>
      </div>
    </div>
  )
}

// ---- workspace header + tabs (app chrome, reproduced statically) -----------
function WorkspaceHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0 10px', flexWrap: 'wrap' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>{PLAN.listName}</h2>
      <DraftBadge />
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <ToolButton icon={<Icon name="share-2" size={14} />}>Share</ToolButton>
        <ToolButton icon={<Icon name="settings-2" size={14} />}>List options</ToolButton>
      </span>
    </div>
  )
}
function WorkspaceTabs() {
  const tabs = [
    { id: 'gear', label: 'Gear list', icon: 'package' },
    { id: 'pack', label: 'Pack', icon: 'package-check' },
    { id: 'food', label: 'Food plan', icon: 'utensils' },
  ]
  return (
    <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
      {tabs.map((t) => {
        const on = t.id === 'food'
        return (
          <span key={t.id} role="tab" aria-selected={on} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: on ? '2px solid var(--action)' : '2px solid transparent', marginBottom: -1, color: on ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 'var(--text-sm)', fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-medium)', whiteSpace: 'nowrap' }}>
            <Icon name={t.icon} size={14} /><span>{t.label}</span>
          </span>
        )
      })}
    </div>
  )
}

// ---- throwaway marker banner ----------------------------------------------
function PrototypeBanner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: 'var(--action-soft-bg)', borderBottom: '1px solid var(--action-soft-border)', color: 'var(--action-soft-text)', fontSize: 'var(--text-xs)' }}>
      <Icon name="info" size={14} />
      <span><strong>Design prototype</strong> - read-only visual-parity reference of the approved Food Plan screen. Not production; data is fixture-only. URL gate: <Mono color="var(--action-soft-text)">?variant=design-prototype</Mono></span>
    </div>
  )
}

// ---- page ------------------------------------------------------------------
export default function FoodPlanDesignPrototype() {
  const [unit, setUnit] = useState<WeightUnit>('oz')
  return (
    <UnitContext.Provider value={unit}>
      <div className="fp-design-prototype" style={{ fontFamily: 'var(--font-sans)', background: 'var(--app-bg)', color: 'var(--text-primary)', minHeight: '100%' }}>
        <style>{TOKENS_CSS}</style>
        <PrototypeBanner />
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 20px' }}>
          <WorkspaceHeader />
          <WorkspaceTabs />
        </div>
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '14px 20px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <PlanStats />
            <span style={{ marginLeft: 'auto' }}><PlanTools unit={unit} onUnit={setUnit} /></span>
          </div>
          <div style={{ marginBottom: 14 }}><ScheduleLine /></div>
          <div style={{ marginBottom: 14 }}><AllDaysSummary /></div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', overflow: 'hidden' }}>
            {DAYS.map((d) => <DaySection key={d.n} day={d} />)}
            <ExtrasSection />
          </div>
        </div>
      </div>
    </UnitContext.Provider>
  )
}
