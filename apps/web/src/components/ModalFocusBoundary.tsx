import { useEffect, useRef, type ReactNode } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalFocusBoundaryProps {
  ariaLabelledby: string;
  children: ReactNode;
  className?: string | undefined;
  onDismiss?: (() => void) | undefined;
  role?: 'dialog' | 'alertdialog';
}

export function ModalFocusBoundary({
  ariaLabelledby,
  children,
  className,
  onDismiss,
  role = 'dialog',
}: ModalFocusBoundaryProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    const firstFocusable = root?.querySelector<HTMLElement>(focusableSelector);
    (firstFocusable ?? root)?.focus();

    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={className}
      role={role}
      aria-modal="true"
      aria-labelledby={ariaLabelledby}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onDismiss) {
          event.preventDefault();
          event.stopPropagation();
          onDismiss();
          return;
        }
        if (event.key !== 'Tab') return;

        const focusable = [
          ...(rootRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
        ];
        if (focusable.length === 0) {
          event.preventDefault();
          rootRef.current?.focus();
          return;
        }

        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      {children}
    </div>
  );
}
