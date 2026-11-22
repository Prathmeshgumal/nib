import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';

// A row at the foot of the sidebar, worded by what it does - "Dark mode" while
// the page is light - rather than a lone icon squeezed beside the name, where
// it sat next to the button that hides the sidebar and read as one of a pair.
export function ModeToggle({ className }) {
  const { resolved, setTheme } = useTheme();
  const isDark = resolved === 'dark';
  const label = isDark ? 'Light mode' : 'Dark mode';

  return (
    <Button
      variant="ghost"
      className={className}
      title={`Switch to ${label.toLowerCase()}`}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun /> : <Moon />}
      <span className={cn('truncate')}>{label}</span>
    </Button>
  );
}
