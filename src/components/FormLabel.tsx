import type { LabelHTMLAttributes } from 'react'

export default function FormLabel({
  className = '',
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // Callers provide htmlFor; this wrapper only centralizes visual label
    // styling. jsx-a11y cannot statically see the associated control through
    // the spread.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      className={['mb-1 block text-sm font-medium text-gray-700', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}
