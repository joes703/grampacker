import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  fullWidth?: boolean
  size?: 'sm' | 'md' | 'icon'
  disabledOpacity?: '40' | '50'
}

export default function PrimaryButton({
  fullWidth = false,
  size = 'md',
  disabledOpacity = '50',
  className = '',
  type = 'button',
  ...props
}: Props) {
  const sizeClass =
    size === 'sm' ? 'px-3 py-1.5' : size === 'icon' ? 'h-9 w-9' : 'px-4 py-2'
  const disabledClass = disabledOpacity === '40' ? 'disabled:opacity-40' : 'disabled:opacity-50'
  return (
    <button
      type={type}
      className={[
        'inline-flex items-center justify-center rounded-lg bg-blue-600 text-sm font-medium text-white hover:bg-blue-700',
        disabledClass,
        sizeClass,
        fullWidth ? 'w-full' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
