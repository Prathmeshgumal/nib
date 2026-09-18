import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { viewerRoute } from '@/lib/attachments';
import '@/index.css';

// The whole of the routing. There are two pages - the notes, and one
// attachment on its own - and the viewer is only ever arrived at by opening a
// link in a new tab, never navigated to from inside the app. A router library
// would be several kilobytes to answer a question this reads off the URL.
const route = viewerRoute(window.location.pathname, window.location.search);

// The server answers any unknown path with index.html, so a mistyped /view/
// URL would otherwise land on the notes - where the relative image paths a
// note uses resolve against /view/ and quietly break. Send it home instead.
if (!route && window.location.pathname.startsWith('/view/')) {
  window.location.replace('/');
}

// Split out so that opening the notes - which is almost every load - does not
// also download a table renderer and a CSV parser it will never run.
const Viewer = lazy(() => import('@/Viewer'));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        {route ? (
          <Suspense fallback={null}>
            <Viewer name={route.name} label={route.label} />
          </Suspense>
        ) : (
          <App />
        )}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>
);
