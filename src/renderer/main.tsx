import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider } from 'react-router'
import { AppProviders } from './app/AppProviders'
import { i18n } from './app/i18n'
import { queryClient } from './lib/ipc'
import { router } from './app/router'
import './theme/theme.css'

const root = document.getElementById('root')
if (!root) throw new Error('root element missing')

createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>
)
