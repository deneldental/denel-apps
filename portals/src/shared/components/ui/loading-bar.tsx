import { useEffect, useState } from 'react'

interface LoadingBarProps {
  isLoading: boolean
}

export function LoadingBar({ isLoading }: LoadingBarProps) {
  const [progress, setProgress] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const [isFadingOut, setIsFadingOut] = useState(false)

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>

    if (isLoading) {
      setIsVisible(true)
      setIsFadingOut(false)
      setProgress(0)

      // Simulate progress up to 90%
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return 90
          const increment = Math.random() * 10
          return Math.min(prev + increment, 90)
        })
      }, 200)
    } else {
      // Complete the progress to 100%
      setProgress(100)

      // Start fade out after a brief delay
      const fadeTimeout = setTimeout(() => {
        setIsFadingOut(true)
        // Completely hide after fade duration (e.g., 300ms)
        const hideTimeout = setTimeout(() => {
          setIsVisible(false)
          setProgress(0)
        }, 300)
        return () => clearTimeout(hideTimeout)
      }, 200)

      return () => {
        clearTimeout(fadeTimeout)
      }
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isLoading])

  if (!isVisible) return null

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[100] h-1 w-full overflow-hidden bg-transparent transition-opacity duration-300 ${isFadingOut ? 'opacity-0' : 'opacity-100'}`}
    >
      <div
        className="h-full bg-green-500 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(34,197,94,0.6)]"
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}
