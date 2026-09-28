import { useNavigate } from 'react-router-dom'

// For pages using useEffect + redirect pattern
export function useRouter() {
  const navigate = useNavigate()
  return {
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
  }
}

// For navigation in handlers - use useNavigate from react-router-dom
// Instead of redirect(), use navigate() from useNavigate hook

// For notFound equivalent - throw a custom error and catch in ErrorBoundary
export class NotFoundError extends Error {
  constructor(message = 'Not Found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

// Alternative: use React Router's navigate in useEffect:
// const navigate = useNavigate()
// useEffect(() => { navigate('/path') }, [navigate])
