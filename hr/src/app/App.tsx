import { BrowserRouter } from 'react-router-dom'
import { AppErrorBoundary } from '@/shared/components/app-error-boundary'
import { Providers } from './providers'
import { AppRouter } from './router'

export function App() {
  return (
    <BrowserRouter>
      <AppErrorBoundary scope="root">
        <Providers>
          <AppRouter />
        </Providers>
      </AppErrorBoundary>
    </BrowserRouter>
  )
}
