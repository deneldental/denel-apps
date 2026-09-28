import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

interface LoadingContextType {
  isLoading: boolean
  startLoading: () => void
  stopLoading: () => void
  setIsLoading: (loading: boolean) => void
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined)

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoadingState] = useState(false)
  const loadingCount = useRef(0)
  const _location = useLocation()

  const startLoading = useCallback(() => {
    loadingCount.current += 1
    if (loadingCount.current === 1) {
      setIsLoadingState(true)
    }
  }, [])

  const stopLoading = useCallback(() => {
    loadingCount.current = Math.max(0, loadingCount.current - 1)
    if (loadingCount.current === 0) {
      setIsLoadingState(false)
    }
  }, [])

  const setIsLoading = useCallback(
    (loading: boolean) => {
      if (loading) {
        startLoading()
      } else {
        stopLoading()
      }
    },
    [startLoading, stopLoading]
  )

  // Safety valve: reset loading if stuck for too long
  useEffect(() => {
    if (isLoading) {
      const safetyTimer = setTimeout(() => {
        if (loadingCount.current > 0) {
          console.warn('Loading stuck for 10s, resetting count.')
          loadingCount.current = 0
          setIsLoadingState(false)
        }
      }, 10000)
      return () => clearTimeout(safetyTimer)
    }
  }, [isLoading])

  // Provide visual feedback on page transition
  useEffect(() => {
    let completed = false
    startLoading()

    const timer = setTimeout(() => {
      if (!completed) {
        stopLoading()
        completed = true
      }
    }, 400)

    return () => {
      if (!completed) {
        stopLoading()
        completed = true
      }
      clearTimeout(timer)
    }
  }, [startLoading, stopLoading])

  return (
    <LoadingContext.Provider value={{ isLoading, startLoading, stopLoading, setIsLoading }}>
      {children}
    </LoadingContext.Provider>
  )
}

export function useLoading() {
  const context = useContext(LoadingContext)
  if (context === undefined) {
    throw new Error('useLoading must be used within a LoadingProvider')
  }
  return context
}
