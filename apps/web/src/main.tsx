import './index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { App } from './App.tsx';
import { ThemeProvider } from './lib/theme.tsx';
import { createQueryClient, createTrpcClient, TRPCProvider } from './lib/trpc.ts';

function Providers() {
  const [queryClient] = useState(createQueryClient);
  const [trpcClient] = useState(createTrpcClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <TooltipProvider delayDuration={300}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </TRPCProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
);
