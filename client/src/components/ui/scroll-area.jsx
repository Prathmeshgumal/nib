import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/utils';

const ScrollArea = React.forwardRef(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn('relative', className)} {...props}>
    {/* Radix wraps the children in a `display: table` div, which grows to fit
        its widest line. That stops `truncate` from ever kicking in and lets the
        list scroll sideways when a long title is focused. Making it a block
        keeps it the width of the viewport. */}
    <ScrollAreaPrimitive.Viewport className="focus-visible:ring-ring/50 size-full rounded-[inherit] outline-none focus-visible:ring-[3px] [&>div]:block!">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation="vertical"
      className="flex h-full w-2.5 touch-none border-l border-l-transparent p-px transition-colors select-none"
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="bg-border relative flex-1 rounded-full" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = 'ScrollArea';

export { ScrollArea };
