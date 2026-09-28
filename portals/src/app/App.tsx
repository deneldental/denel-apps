import { BrowserRouter } from 'react-router-dom'
import { AppErrorBoundary } from '@/shared/components/app-error-boundary'
import { DbFlavorPill } from '@/shared/components/db-flavor-pill'
import { Providers } from './providers'
import { AppRouter } from './router'

export function App() {
  return (
    <BrowserRouter>
      <AppErrorBoundary scope="root">
        <Providers>
          <AppRouter />
          {/* Dev-only backend-database indicator; renders null in production. */}
          <DbFlavorPill />
        </Providers>
      </AppErrorBoundary>
    </BrowserRouter>
  )
}
