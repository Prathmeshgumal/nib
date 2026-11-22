import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/components/theme-provider';

// Sonner draws its toasts from its own palette - pure black in dark mode, with
// a white action button - unless it is handed ours through its variables.
export function Toaster(props) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-right"
      style={{
        '--normal-bg': 'var(--popover)',
        '--normal-text': 'var(--popover-foreground)',
        '--normal-border': 'var(--border)',
      }}
      toastOptions={{
        classNames: {
          toast: 'shadow-lg',
          description: '!text-muted-foreground',
          actionButton: '!bg-primary !text-primary-foreground',
        },
      }}
      {...props}
    />
  );
}
