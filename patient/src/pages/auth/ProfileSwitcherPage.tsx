import { useNavigate } from 'react-router-dom'
import { ProfilePicker } from './profile-picker'

/**
 * In-app family profile switcher. Reachable from the profile screen while signed
 * in — the device stays trusted, so switching needs no OTP. Selecting a profile
 * re-issues the session for that patient and returns home.
 */
export default function ProfileSwitcherPage() {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Switch profile</h1>
          <p className="text-sm text-muted-foreground">Choose a family member to view.</p>
        </div>
        <ProfilePicker onSelected={() => navigate('/patient/home', { replace: true })} />
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-full text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
