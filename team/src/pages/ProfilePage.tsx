import {
  Bell,
  Book,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  FileDown,
  FileText,
  Globe,
  HelpCircle,
  Inbox,
  Loader2,
  LogOut,
  Moon,
  Pencil,
  User,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { env } from '@/config/env'
import { staffApi } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { NotificationPrefsCard } from '@/shared/components/notification-prefs-card'

interface ProfileData {
  id: string
  staffId: string
  fullName: string
  username: string
  email?: string
  phone?: string
  role: string
  employmentType: string
  dateOfJoining?: string
  status: string
  isExternalTrainer: boolean
  profileImage?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  emergencyContactRelationship?: string
  dateOfBirth?: string
  gender?: string
  ghanaCardPin?: string
  nationality?: string
  residentialAddress?: string
  digitalAddress?: string
  nextOfKinName?: string
  nextOfKinRelationship?: string
  nextOfKinPhone?: string
  department?: string
  cvUrl?: string
  bankName?: string
  bankAccountName?: string
  bankAccountNumber?: string
  ssnitId?: string
}

interface ChangeRequest {
  id: string
  changeType: string
  requestedData: {
    field?: string
    currentValue?: string
    requestedValue?: string
    notes?: string
  }
  status: 'pending' | 'approved' | 'rejected'
  reviewComments?: string
  submittedAt: string
}

const CHANGE_TYPES = [
  { value: 'bank_details', label: 'Bank Details' },
  { value: 'bio', label: 'Bio / Personal Info' },
  { value: 'contact', label: 'Contact Information' },
  { value: 'emergency_contact', label: 'Emergency Contact' },
  { value: 'other', label: 'Other' },
]

const SELF_SERVICE_FIELDS: Record<string, { changeType: string; label: string }> = {
  phone: { changeType: 'contact', label: 'Phone Number' },
  email: { changeType: 'contact', label: 'Email Address' },
  residentialAddress: { changeType: 'contact', label: 'Residential Address' },
  digitalAddress: { changeType: 'contact', label: 'Digital Address' },
  emergencyContactName: { changeType: 'emergency_contact', label: 'Emergency Contact Name' },
  emergencyContactRelationship: {
    changeType: 'emergency_contact',
    label: 'Emergency Contact Relationship',
  },
  emergencyContactPhone: { changeType: 'emergency_contact', label: 'Emergency Contact Phone' },
  nextOfKinName: { changeType: 'emergency_contact', label: 'Next of Kin Name' },
  nextOfKinRelationship: { changeType: 'emergency_contact', label: 'Next of Kin Relationship' },
  nextOfKinPhone: { changeType: 'emergency_contact', label: 'Next of Kin Phone' },
  nationality: { changeType: 'bio', label: 'Nationality' },
  bankName: { changeType: 'bank_details', label: 'Bank Name' },
  bankAccountName: { changeType: 'bank_details', label: 'Bank Account Name' },
  bankAccountNumber: { changeType: 'bank_details', label: 'Bank Account Number' },
}

function getFieldLabel(field?: string): string {
  if (!field) return ''
  return SELF_SERVICE_FIELDS[field]?.label ?? field
}

export default function ProfilePage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)
  const [downloadingSheet, setDownloadingSheet] = useState(false)
  const [sheetError, setSheetError] = useState(false)

  // View state: 'menu' (main tab view), 'details' (View Profile screen), or
  // 'notifications' (notification channel preferences).
  const [viewMode, setViewMode] = useState<'menu' | 'details' | 'notifications'>('menu')

  // Section edit states
  const [editingSection, setEditingSection] = useState<
    'bio' | 'contact' | 'emergency' | 'payroll' | null
  >(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([])

  // Image Upload states
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadingCv, setUploadingCv] = useState(false)

  // Section 1: Bio Fields
  const [editFullName, setEditFullName] = useState('')
  const [editGender, setEditGender] = useState('')
  const [editDob, setEditDob] = useState('')
  const [editNationality, setEditNationality] = useState('')
  const [editGhanaCardPin, setEditGhanaCardPin] = useState('')

  // Section 2: Contact Fields
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editResidential, setEditResidential] = useState('')
  const [editDigitalAddress, setEditDigitalAddress] = useState('')

  // Section 4: Emergency Contacts & Next of Kin
  const [editEmergencyName, setEditEmergencyName] = useState('')
  const [editEmergencyPhone, setEditEmergencyPhone] = useState('')
  const [editEmergencyRelation, setEditEmergencyRelation] = useState('')
  const [editNokName, setEditNokName] = useState('')
  const [editNokPhone, setEditNokPhone] = useState('')
  const [editNokRelation, setEditNokRelation] = useState('')

  // Section 6: Payment & Payroll
  const [editBankName, setEditBankName] = useState('')
  const [editBankAccountName, setEditBankAccountName] = useState('')
  const [editBankAccountNumber, setEditBankAccountNumber] = useState('')
  const [editSsnitId, setEditSsnitId] = useState('')

  useEffect(() => {
    staffApi
      .getProfile()
      .then((res) => {
        if (res.success && res.data) {
          const data = res.data as ProfileData
          setProfile(data)
          if (data.profileImage) {
            setPhotoUrl(data.profileImage)
          }
        }
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })

    staffApi
      .getProfileChangeRequests()
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setChangeRequests(res.data as ChangeRequest[])
        }
      })
      .catch(() => {})
  }, [])

  const handleLogout = async () => {
    setLoggingOut(true)
    await signOut()
    navigate('/login', { replace: true })
  }

  const handleDownloadSheet = async () => {
    setSheetError(false)
    setDownloadingSheet(true)
    try {
      const res = await fetch(`${env.VITE_API_URL}/api/staff-portal/data-sheet`, {
        credentials: 'include',
        headers: { 'X-App-Id': 'pwa' },
      })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `employee-data-sheet-${profile?.staffId ?? 'me'}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setSheetError(true)
    } finally {
      setDownloadingSheet(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingPhoto(true)
    const preview = URL.createObjectURL(file)
    setPhotoUrl(preview)

    try {
      const res = await staffApi.uploadAvatar(file)
      const url = (res as { url?: string }).url
      if (res.success && url) {
        setPhotoUrl(url)
        setProfile((prev) => (prev ? { ...prev, profileImage: url } : null))
        toast.success('Profile picture updated successfully')
      } else {
        toast.error(res.error || 'Failed to save photo')
      }
    } catch {
      toast.error('Failed to upload photo')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleCvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingCv(true)
    setSubmitError('')
    setSubmitSuccess(false)

    try {
      const uploadRes = await staffApi.uploadAttachment(file)
      const url = (uploadRes as { url?: string }).url
      if (!uploadRes.success || !url) {
        throw new Error(uploadRes.error || 'Failed to upload CV file')
      }

      const changeRes = await staffApi.submitProfileChangeRequest({
        changeType: 'other',
        requestedData: {
          field: 'cvUrl',
          requestedValue: url,
          notes: `Requesting to update CV Document to: ${url}`,
        },
      })

      if (changeRes.success) {
        setSubmitSuccess(true)
        toast.success('CV uploaded and update request submitted')

        const listRes = await staffApi.getProfileChangeRequests()
        if (listRes.success && Array.isArray(listRes.data)) {
          setChangeRequests(listRes.data as ChangeRequest[])
        }
        setTimeout(() => setSubmitSuccess(false), 4000)
      } else {
        toast.error(changeRes.error || 'Failed to submit CV change request')
      }
    } catch (err) {
      const error = err as { message?: string }
      setSubmitError(error.message || 'Failed to upload CV')
      toast.error(error.message || 'Failed to upload CV')
    } finally {
      setUploadingCv(false)
    }
  }

  const triggerUpload = () => {
    document.getElementById('avatar-upload-input')?.click()
  }

  // Section edit triggers
  const startEditBio = () => {
    setEditFullName(profile?.fullName ?? '')
    setEditGender(profile?.gender ?? '')
    setEditDob(
      profile?.dateOfBirth ? new Date(profile.dateOfBirth).toISOString().split('T')[0] : ''
    )
    setEditNationality(profile?.nationality ?? '')
    setEditGhanaCardPin(profile?.ghanaCardPin ?? '')
    setSubmitError('')
    setEditingSection('bio')
  }

  const startEditContact = () => {
    setEditPhone(profile?.phone ?? '')
    setEditEmail(profile?.email ?? '')
    setEditResidential(profile?.residentialAddress ?? '')
    setEditDigitalAddress(profile?.digitalAddress ?? '')
    setSubmitError('')
    setEditingSection('contact')
  }

  const startEditEmergency = () => {
    setEditEmergencyName(profile?.emergencyContactName ?? '')
    setEditEmergencyPhone(profile?.emergencyContactPhone ?? '')
    setEditEmergencyRelation(profile?.emergencyContactRelationship ?? '')
    setEditNokName(profile?.nextOfKinName ?? '')
    setEditNokPhone(profile?.nextOfKinPhone ?? '')
    setEditNokRelation(profile?.nextOfKinRelationship ?? '')
    setSubmitError('')
    setEditingSection('emergency')
  }

  const startEditPayroll = () => {
    setEditBankName(profile?.bankName ?? '')
    setEditBankAccountName(profile?.bankAccountName ?? '')
    setEditBankAccountNumber(profile?.bankAccountNumber ?? '')
    setEditSsnitId(profile?.ssnitId ?? '')
    setSubmitError('')
    setEditingSection('payroll')
  }

  const handleSaveSection = async (section: 'bio' | 'contact' | 'emergency' | 'payroll') => {
    if (!profile) return
    setSubmitting(true)
    setSubmitError('')

    interface ChangeItem {
      field: string
      label: string
      currentValue: string
      requestedValue: string
      changeType: string
    }

    const changes: ChangeItem[] = []

    if (section === 'bio') {
      if (editFullName.trim() !== profile.fullName) {
        changes.push({
          field: 'fullName',
          label: 'Full Name',
          currentValue: profile.fullName,
          requestedValue: editFullName.trim(),
          changeType: 'bio',
        })
      }
      if (editGender !== (profile.gender ?? '')) {
        changes.push({
          field: 'gender',
          label: 'Gender',
          currentValue: profile.gender ?? '',
          requestedValue: editGender,
          changeType: 'bio',
        })
      }
      const origDob = profile.dateOfBirth
        ? new Date(profile.dateOfBirth).toISOString().split('T')[0]
        : ''
      if (editDob !== origDob) {
        changes.push({
          field: 'dateOfBirth',
          label: 'Date of Birth',
          currentValue: origDob,
          requestedValue: editDob,
          changeType: 'bio',
        })
      }
      if (editNationality.trim() !== (profile.nationality ?? '')) {
        changes.push({
          field: 'nationality',
          label: 'Nationality',
          currentValue: profile.nationality ?? '',
          requestedValue: editNationality.trim(),
          changeType: 'bio',
        })
      }
      if (editGhanaCardPin.trim() !== (profile.ghanaCardPin ?? '')) {
        changes.push({
          field: 'ghanaCardPin',
          label: 'Ghana Card PIN',
          currentValue: profile.ghanaCardPin ?? '',
          requestedValue: editGhanaCardPin.trim(),
          changeType: 'bio',
        })
      }
    } else if (section === 'contact') {
      if (editPhone.trim() !== (profile.phone ?? '')) {
        changes.push({
          field: 'phone',
          label: 'Phone',
          currentValue: profile.phone ?? '',
          requestedValue: editPhone.trim(),
          changeType: 'contact',
        })
      }
      if (editEmail.trim() !== (profile.email ?? '')) {
        changes.push({
          field: 'email',
          label: 'Email',
          currentValue: profile.email ?? '',
          requestedValue: editEmail.trim(),
          changeType: 'contact',
        })
      }
      if (editResidential.trim() !== (profile.residentialAddress ?? '')) {
        changes.push({
          field: 'residentialAddress',
          label: 'Residential Address',
          currentValue: profile.residentialAddress ?? '',
          requestedValue: editResidential.trim(),
          changeType: 'contact',
        })
      }
      if (editDigitalAddress.trim() !== (profile.digitalAddress ?? '')) {
        changes.push({
          field: 'digitalAddress',
          label: 'Digital Address',
          currentValue: profile.digitalAddress ?? '',
          requestedValue: editDigitalAddress.trim(),
          changeType: 'contact',
        })
      }
    } else if (section === 'emergency') {
      if (editEmergencyName.trim() !== (profile.emergencyContactName ?? '')) {
        changes.push({
          field: 'emergencyContactName',
          label: 'Emergency Contact Name',
          currentValue: profile.emergencyContactName ?? '',
          requestedValue: editEmergencyName.trim(),
          changeType: 'emergency_contact',
        })
      }
      if (editEmergencyPhone.trim() !== (profile.emergencyContactPhone ?? '')) {
        changes.push({
          field: 'emergencyContactPhone',
          label: 'Emergency Contact Phone',
          currentValue: profile.emergencyContactPhone ?? '',
          requestedValue: editEmergencyPhone.trim(),
          changeType: 'emergency_contact',
        })
      }
      if (editEmergencyRelation.trim() !== (profile.emergencyContactRelationship ?? '')) {
        changes.push({
          field: 'emergencyContactRelationship',
          label: 'Emergency Contact Relationship',
          currentValue: profile.emergencyContactRelationship ?? '',
          requestedValue: editEmergencyRelation.trim(),
          changeType: 'emergency_contact',
        })
      }
      if (editNokName.trim() !== (profile.nextOfKinName ?? '')) {
        changes.push({
          field: 'nextOfKinName',
          label: 'Next of Kin Name',
          currentValue: profile.nextOfKinName ?? '',
          requestedValue: editNokName.trim(),
          changeType: 'emergency_contact',
        })
      }
      if (editNokPhone.trim() !== (profile.nextOfKinPhone ?? '')) {
        changes.push({
          field: 'nextOfKinPhone',
          label: 'Next of Kin Phone',
          currentValue: profile.nextOfKinPhone ?? '',
          requestedValue: editNokPhone.trim(),
          changeType: 'emergency_contact',
        })
      }
      if (editNokRelation.trim() !== (profile.nextOfKinRelationship ?? '')) {
        changes.push({
          field: 'nextOfKinRelationship',
          label: 'Next of Kin Relationship',
          currentValue: profile.nextOfKinRelationship ?? '',
          requestedValue: editNokRelation.trim(),
          changeType: 'emergency_contact',
        })
      }
    } else if (section === 'payroll') {
      if (editBankName.trim() !== (profile.bankName ?? '')) {
        changes.push({
          field: 'bankName',
          label: 'Bank Name',
          currentValue: profile.bankName ?? '',
          requestedValue: editBankName.trim(),
          changeType: 'bank_details',
        })
      }
      if (editBankAccountName.trim() !== (profile.bankAccountName ?? '')) {
        changes.push({
          field: 'bankAccountName',
          label: 'Bank Account Name',
          currentValue: profile.bankAccountName ?? '',
          requestedValue: editBankAccountName.trim(),
          changeType: 'bank_details',
        })
      }
      if (editBankAccountNumber.trim() !== (profile.bankAccountNumber ?? '')) {
        changes.push({
          field: 'bankAccountNumber',
          label: 'Bank Account Number',
          currentValue: profile.bankAccountNumber ?? '',
          requestedValue: editBankAccountNumber.trim(),
          changeType: 'bank_details',
        })
      }
      if (editSsnitId.trim() !== (profile.ssnitId ?? '')) {
        changes.push({
          field: 'ssnitId',
          label: 'SSNIT Number',
          currentValue: profile.ssnitId ?? '',
          requestedValue: editSsnitId.trim(),
          changeType: 'other',
        })
      }
    }

    if (changes.length === 0) {
      setEditingSection(null)
      setSubmitting(false)
      return
    }

    try {
      for (const change of changes) {
        const isSelfService = SELF_SERVICE_FIELDS[change.field]
        const data = isSelfService
          ? {
              changeType: change.changeType,
              requestedData: {
                field: change.field,
                currentValue: change.currentValue,
                requestedValue: change.requestedValue,
              },
            }
          : {
              changeType: 'other',
              requestedData: {
                notes: `Requesting to update ${change.label} from "${change.currentValue || '—'}" to "${change.requestedValue || '—'}"`,
              },
            }

        const res = await staffApi.submitProfileChangeRequest(data)
        if (!res.success) {
          throw new Error(res.error || `Failed to submit request for ${change.label}`)
        }
      }

      setSubmitSuccess(true)
      setEditingSection(null)

      const listRes = await staffApi.getProfileChangeRequests()
      if (listRes.success && Array.isArray(listRes.data)) {
        setChangeRequests(listRes.data as ChangeRequest[])
      }
      setTimeout(() => setSubmitSuccess(false), 4000)
    } catch (err) {
      const error = err as { message?: string }
      setSubmitError(error.message || 'Failed to submit changes')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="page-enter p-5 space-y-4">
        <div className="skeleton h-36 rounded-lg animate-pulse" />
        <div className="skeleton h-48 rounded-lg animate-pulse" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="page-enter flex flex-col items-center justify-center h-[70vh] text-muted-foreground p-5">
        <User size={48} className="mb-2 opacity-50 text-primary" />
        <p className="font-semibold text-sm text-primary/80">Unable to load profile</p>
        <Button
          variant="outline"
          className="mt-4 border-primary/20 text-primary"
          onClick={handleLogout}
        >
          <LogOut size={16} />
          Sign Out
        </Button>
      </div>
    )
  }

  const displayRole = (user?.roleId ?? profile.role)?.replace(/_/g, ' ')

  const renderField = (label: string, value: string | number | undefined | null) => (
    <div className="space-y-1">
      <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-semibold text-stone-700 truncate">{value || '—'}</div>
    </div>
  )

  const renderSectionHeader = (
    title: string,
    _sectionKey: 'bio' | 'contact' | 'emergency' | 'payroll',
    startEditFn: () => void
  ) => {
    return (
      <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-4 shrink-0">
        <h3 className="font-bold text-base text-primary">{title}</h3>
        {!editingSection && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2.5 gap-1.5 border-primary/20 text-primary hover:bg-primary/5 cursor-pointer"
            onClick={startEditFn}
          >
            <Pencil size={12} />
            Edit
          </Button>
        )}
      </div>
    )
  }

  const renderSectionActions = (sectionKey: 'bio' | 'contact' | 'emergency' | 'payroll') => (
    <div className="flex justify-end gap-2 pt-3 border-t border-stone-100 mt-4">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setEditingSection(null)}
        className="h-8 text-xs font-semibold"
        disabled={submitting}
      >
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => handleSaveSection(sectionKey)}
        className="h-8 text-xs bg-primary text-white hover:bg-primary/90 font-semibold"
        disabled={submitting}
      >
        {submitting ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
        Save Section
      </Button>
    </div>
  )

  return (
    <div className="page-enter p-5 pb-16 space-y-6">
      {/* Hidden file inputs */}
      <input
        type="file"
        id="avatar-upload-input"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        type="file"
        id="cv-upload-input"
        accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
        className="hidden"
        onChange={handleCvFileChange}
      />

      {viewMode === 'menu' ? (
        <>
          {/* Menu / Profile Main View */}
          <div className="px-1 mt-2">
            <h1 className="text-2xl font-black tracking-tight text-primary">Profile</h1>
          </div>

          {/* User Profile Card Row */}
          <div className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm border border-stone-100/60 active:scale-[0.99] transition-all">
            {/* Avatar with Click-to-upload badge */}
            <div className="relative shrink-0 cursor-pointer" onClick={triggerUpload}>
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={profile.fullName}
                  className="w-14 h-14 rounded-full object-cover shadow-inner border border-stone-100"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white text-lg font-bold shadow-inner">
                  {profile.fullName?.charAt(0)?.toUpperCase() || 'S'}
                </div>
              )}
              <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-sm border border-stone-100 text-primary hover:bg-stone-50 active:scale-95 transition-all">
                {uploadingPhoto ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Camera size={12} />
                )}
              </div>
            </div>

            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setViewMode('details')}>
              <h2 className="font-bold text-base text-primary truncate">{profile.fullName}</h2>
              <p className="text-xs text-stone-500 capitalize mt-0.5">{displayRole}</p>
            </div>
            <ChevronRight
              size={18}
              className="text-stone-400 cursor-pointer"
              onClick={() => setViewMode('details')}
            />
          </div>

          {/* Menu Action List */}
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
            {/* Download Data Sheet */}
            <div
              onClick={handleDownloadSheet}
              className={cn(
                'flex items-center gap-3 px-4 py-4 hover:bg-stone-50 active:bg-stone-100 border-b border-stone-100 cursor-pointer transition-colors',
                downloadingSheet && 'opacity-70 pointer-events-none'
              )}
            >
              {downloadingSheet ? (
                <Loader2 size={18} className="animate-spin text-primary" />
              ) : (
                <FileDown size={18} className="text-primary" />
              )}
              <span className="flex-1 text-sm font-semibold text-stone-700">
                Download Data Sheet (PDF)
              </span>
              <ChevronRight size={16} className="text-stone-400" />
            </div>

            {/* Notifications */}
            <div
              onClick={() => setViewMode('notifications')}
              className="flex items-center gap-3 px-4 py-4 hover:bg-stone-50 active:bg-stone-100 border-b border-stone-100 cursor-pointer transition-colors"
            >
              <Bell size={18} className="text-primary" />
              <span className="flex-1 text-sm font-semibold text-stone-700">Notifications</span>
              <ChevronRight size={16} className="text-stone-400" />
            </div>

            {/* HR Handbook */}
            <div
              onClick={() => navigate('/handbook')}
              className="flex items-center gap-3 px-4 py-4 hover:bg-stone-50 active:bg-stone-100 border-b border-stone-100 cursor-pointer transition-colors"
            >
              <Book size={18} className="text-primary" />
              <span className="flex-1 text-sm font-semibold text-stone-700">HR Handbook</span>
              <ChevronRight size={16} className="text-stone-400" />
            </div>

            {/* Suggestion Box */}
            <div
              onClick={() => navigate('/requests?tab=suggestions')}
              className="flex items-center gap-3 px-4 py-4 hover:bg-stone-50 active:bg-stone-100 border-b border-stone-100 cursor-pointer transition-colors"
            >
              <Inbox size={18} className="text-primary" />
              <span className="flex-1 text-sm font-semibold text-stone-700">Suggestion Box</span>
              <ChevronRight size={16} className="text-stone-400" />
            </div>

            {/* Help */}
            <div
              onClick={() => toast.info('Help Desk coming soon')}
              className="flex items-center gap-3 px-4 py-4 hover:bg-stone-50 active:bg-stone-100 border-b border-stone-100 cursor-pointer transition-colors"
            >
              <HelpCircle size={18} className="text-primary" />
              <span className="flex-1 text-sm font-semibold text-stone-700">Help</span>
              <ChevronRight size={16} className="text-stone-400" />
            </div>

            {/* Dark Mode */}
            <div
              onClick={() => toast.info('Dark Mode toggle coming soon')}
              className="flex items-center gap-3 px-4 py-4 hover:bg-stone-50 active:bg-stone-100 border-b border-stone-100 cursor-pointer transition-colors"
            >
              <Moon size={18} className="text-primary" />
              <span className="flex-1 text-sm font-semibold text-stone-700">Dark Mode</span>
              <ChevronRight size={16} className="text-stone-400" />
            </div>

            {/* Website */}
            <div
              onClick={() => window.open('https://deneldental.com', '_blank')}
              className="flex items-center gap-3 px-4 py-4 hover:bg-stone-50 active:bg-stone-100 border-b border-stone-100 cursor-pointer transition-colors"
            >
              <Globe size={18} className="text-primary" />
              <span className="flex-1 text-sm font-semibold text-stone-700">Website</span>
              <ChevronRight size={16} className="text-stone-400" />
            </div>

            {/* Breakfast — still in development; show a "coming soon" toast
                rather than routing into the unfinished section. */}
            <div
              onClick={() => toast('Breakfast is coming soon')}
              className="flex items-center gap-3 px-4 py-4 hover:bg-stone-50 active:bg-stone-100 border-b border-stone-100 cursor-pointer transition-colors"
            >
              <Coffee size={18} className="text-primary" />
              <span className="flex-1 text-sm font-semibold text-stone-700">Breakfast</span>
              <ChevronRight size={16} className="text-stone-400" />
            </div>

            {/* Sign Out */}
            <div
              onClick={handleLogout}
              className={cn(
                'flex items-center gap-3 px-4 py-4 hover:bg-red-50/50 active:bg-red-100/50 cursor-pointer transition-colors',
                loggingOut && 'opacity-70 pointer-events-none'
              )}
            >
              {loggingOut ? (
                <Loader2 size={18} className="animate-spin text-red-600" />
              ) : (
                <LogOut size={18} className="text-red-600" />
              )}
              <span className="flex-1 text-sm font-semibold text-red-600">Sign Out</span>
              <ChevronRight size={16} className="text-red-300" />
            </div>
          </div>

          {sheetError && (
            <p className="text-center text-xs text-destructive font-medium px-2 animate-fade-in">
              Could not generate the PDF. Please try again.
            </p>
          )}
        </>
      ) : viewMode === 'notifications' ? (
        <>
          {/* Notifications preferences */}
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => setViewMode('menu')}
              className="flex items-center justify-center p-2 rounded-full bg-stone-100 hover:bg-stone-200 active:scale-95 text-primary transition-all cursor-pointer shrink-0"
              aria-label="Back to Menu"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-primary">Notifications</h1>
              <p className="text-xs text-stone-500">Choose how you get updates</p>
            </div>
          </div>

          <NotificationPrefsCard
            storageKey="staff-notification-prefs"
            items={[
              {
                id: 'sms',
                label: 'SMS notifications',
                lockedOn: true,
                disabled: true,
                disabledCaption: 'Always on — sent to your registered phone',
              },
            ]}
          />
        </>
      ) : (
        <>
          {/* Detailed View Profile Screen */}
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => {
                setViewMode('menu')
                setEditingSection(null)
              }}
              className="flex items-center justify-center p-2 rounded-full bg-stone-100 hover:bg-stone-200 active:scale-95 text-primary transition-all cursor-pointer shrink-0"
              aria-label="Back to Menu"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-primary">My Profile</h1>
              <p className="text-xs text-stone-500">Full onboarding details and changes</p>
            </div>
          </div>

          {/* Large profile image/initials header in details */}
          <div className="text-center py-2 animate-fade-in">
            <div
              className="relative mx-auto w-20 h-20 shrink-0 cursor-pointer"
              onClick={triggerUpload}
            >
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={profile.fullName}
                  className="w-20 h-20 rounded-full object-cover shadow-md border-2 border-white"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center text-white text-3xl font-bold shadow-md border-2 border-white">
                  {profile.fullName?.charAt(0)?.toUpperCase() || 'S'}
                </div>
              )}
              <div className="absolute -bottom-1 -right-1 bg-white p-1.5 rounded-full shadow-md border border-stone-100 text-primary hover:bg-stone-50 active:scale-95 transition-all">
                {uploadingPhoto ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Camera size={14} />
                )}
              </div>
            </div>

            <h4 className="text-lg font-bold mt-3 text-primary">{profile.fullName}</h4>
            <div className="mt-1 flex justify-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                {profile.status}
              </span>
              {profile.isExternalTrainer && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  Trainer
                </span>
              )}
            </div>
          </div>

          {/* Success Banner */}
          {submitSuccess && (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 text-xs text-green-700 animate-fade-in">
              <CheckCircle2 size={14} className="shrink-0" />
              Changes saved — request(s) submitted for admin review.
            </div>
          )}

          {/* Error Banner */}
          {submitError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 animate-fade-in">
              <XCircle size={14} className="shrink-0" />
              {submitError}
            </div>
          )}

          {/* Section 1: Bio Information */}
          <div className="bg-white rounded-2xl p-5 border border-stone-100/80 shadow-sm">
            {renderSectionHeader('Bio Information', 'bio', startEditBio)}
            {editingSection === 'bio' ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-stone-500">Full Name</Label>
                  <Input
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">Gender</Label>
                    <select
                      value={editGender}
                      onChange={(e) => setEditGender(e.target.value)}
                      className="w-full h-10 rounded-lg border border-stone-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="">Select Gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">Date of Birth</Label>
                    <Input
                      type="date"
                      value={editDob}
                      onChange={(e) => setEditDob(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-stone-500">Nationality</Label>
                  <Input
                    value={editNationality}
                    onChange={(e) => setEditNationality(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-stone-500">Ghana Card PIN</Label>
                  <Input
                    value={editGhanaCardPin}
                    onChange={(e) => setEditGhanaCardPin(e.target.value)}
                    placeholder="e.g. GHA-123456789-0"
                    className="bg-white border-stone-200"
                  />
                </div>
                {renderSectionActions('bio')}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                {renderField('Full Name', profile.fullName)}
                {renderField('Gender', profile.gender)}
                {renderField(
                  'Date of Birth',
                  profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString() : null
                )}
                {renderField('Nationality', profile.nationality)}
                <div className="col-span-2">
                  {renderField('Ghana Card PIN', profile.ghanaCardPin)}
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Contact & Address */}
          <div className="bg-white rounded-2xl p-5 border border-stone-100/80 shadow-sm">
            {renderSectionHeader('Contact & Address', 'contact', startEditContact)}
            {editingSection === 'contact' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">Phone</Label>
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">Email</Label>
                    <Input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-stone-500">
                    Residential Address
                  </Label>
                  <Input
                    value={editResidential}
                    onChange={(e) => setEditResidential(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-stone-500">
                    Digital Address (GPS)
                  </Label>
                  <Input
                    value={editDigitalAddress}
                    onChange={(e) => setEditDigitalAddress(e.target.value)}
                    placeholder="e.g. GA-183-1994"
                    className="bg-white border-stone-200"
                  />
                </div>
                {renderSectionActions('contact')}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                {renderField('Phone', profile.phone)}
                {renderField('Email', profile.email)}
                <div className="col-span-2">
                  {renderField('Residential Address', profile.residentialAddress)}
                </div>
                {renderField('Digital Address (GPS)', profile.digitalAddress)}
              </div>
            )}
          </div>

          {/* Section 3: Employment Details (Read-only) */}
          <div className="bg-white rounded-2xl p-5 border border-stone-100/80 shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-4 shrink-0">
              <h3 className="font-bold text-base text-primary">Employment Details</h3>
              <Badge
                variant="secondary"
                className="bg-stone-50 text-stone-500 border border-stone-100 text-[10px] uppercase font-bold shrink-0"
              >
                Admin Only
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              {renderField('Staff ID', profile.staffId)}
              {renderField('Position / Role', displayRole)}
              {renderField('Department', profile.department)}
              {renderField('Employment Type', profile.employmentType?.replace(/_/g, ' '))}
              {renderField(
                'Date of Joining',
                profile.dateOfJoining ? new Date(profile.dateOfJoining).toLocaleDateString() : null
              )}
              {renderField('Status', profile.status)}
            </div>
          </div>

          {/* Section 4: Emergency Contact & Next of Kin */}
          <div className="bg-white rounded-2xl p-5 border border-stone-100/80 shadow-sm">
            {renderSectionHeader('Emergency & Next of Kin', 'emergency', startEditEmergency)}
            {editingSection === 'emergency' ? (
              <div className="space-y-4">
                <div className="border-b border-stone-100 pb-2 mb-2 font-bold text-xs text-stone-400">
                  EMERGENCY CONTACT
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">Contact Name</Label>
                    <Input
                      value={editEmergencyName}
                      onChange={(e) => setEditEmergencyName(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">Contact Phone</Label>
                    <Input
                      value={editEmergencyPhone}
                      onChange={(e) => setEditEmergencyPhone(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-stone-500">Relationship</Label>
                  <Input
                    value={editEmergencyRelation}
                    onChange={(e) => setEditEmergencyRelation(e.target.value)}
                    placeholder="e.g. Spouse, Parent"
                    className="bg-white border-stone-200"
                  />
                </div>

                <div className="border-b border-stone-100 pb-2 pt-2 mb-2 font-bold text-xs text-stone-400">
                  NEXT OF KIN
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">Next of Kin Name</Label>
                    <Input
                      value={editNokName}
                      onChange={(e) => setEditNokName(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">
                      Next of Kin Phone
                    </Label>
                    <Input
                      value={editNokPhone}
                      onChange={(e) => setEditNokPhone(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-stone-500">Relationship</Label>
                  <Input
                    value={editNokRelation}
                    onChange={(e) => setEditNokRelation(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>
                {renderSectionActions('emergency')}
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <div className="text-xs font-bold text-stone-400 mb-2.5 border-b border-stone-100 pb-1">
                    Emergency Contact
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    {renderField('Name', profile.emergencyContactName)}
                    {renderField('Phone', profile.emergencyContactPhone)}
                    {renderField('Relationship', profile.emergencyContactRelationship)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-stone-400 mb-2.5 border-b border-stone-100 pb-1">
                    Next of Kin
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    {renderField('Name', profile.nextOfKinName)}
                    {renderField('Phone', profile.nextOfKinPhone)}
                    {renderField('Relationship', profile.nextOfKinRelationship)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 5: CV Document (Direct Upload) */}
          <div className="bg-white rounded-2xl p-5 border border-stone-100/80 shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-4 shrink-0">
              <h3 className="font-bold text-base text-primary">CV Document</h3>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5 gap-1.5 border-primary/20 text-primary hover:bg-primary/5 cursor-pointer shrink-0"
                onClick={() => document.getElementById('cv-upload-input')?.click()}
                disabled={uploadingCv}
              >
                {uploadingCv ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <FileText size={12} />
                )}
                Upload CV
              </Button>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">
                Current CV
              </div>
              {profile.cvUrl ? (
                <a
                  href={profile.cvUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  <FileText size={16} />
                  View Uploaded CV
                </a>
              ) : (
                <span className="text-sm font-medium text-stone-500 italic">No CV uploaded</span>
              )}

              {uploadingCv && (
                <p className="text-xs text-primary font-semibold flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" /> Uploading new CV document...
                </p>
              )}
            </div>
          </div>

          {/* Section 6: Payment & Payroll */}
          <div className="bg-white rounded-2xl p-5 border border-stone-100/80 shadow-sm">
            {renderSectionHeader('Payment & Payroll', 'payroll', startEditPayroll)}
            {editingSection === 'payroll' ? (
              <div className="space-y-4">
                <div className="border-b border-stone-100 pb-2 mb-2 font-bold text-xs text-stone-400">
                  BANK DETAILS
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-stone-500">Bank Name</Label>
                  <Input
                    value={editBankName}
                    onChange={(e) => setEditBankName(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">Account Name</Label>
                    <Input
                      value={editBankAccountName}
                      onChange={(e) => setEditBankAccountName(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-stone-500">Account Number</Label>
                    <Input
                      value={editBankAccountNumber}
                      onChange={(e) => setEditBankAccountNumber(e.target.value)}
                      className="bg-white border-stone-200"
                    />
                  </div>
                </div>

                <div className="border-b border-stone-100 pb-2 pt-2 mb-2 font-bold text-xs text-stone-400">
                  TAX & benefits
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-stone-500">SSNIT Number</Label>
                  <Input
                    value={editSsnitId}
                    onChange={(e) => setEditSsnitId(e.target.value)}
                    className="bg-white border-stone-200"
                  />
                </div>
                {renderSectionActions('payroll')}
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <div className="text-xs font-bold text-stone-400 mb-2.5 border-b border-stone-100 pb-1">
                    Bank Payment
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    {renderField('Bank Name', profile.bankName)}
                    {renderField('Account Name', profile.bankAccountName)}
                    {renderField('Account Number', profile.bankAccountNumber)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-stone-400 mb-2.5 border-b border-stone-100 pb-1">
                    Tax & Benefits
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    {renderField('SSNIT Number', profile.ssnitId)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Request History / Pending Changes */}
          <div className="space-y-3 pt-2 animate-fade-in">
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider px-1">
              Change Request History
            </h4>
            {changeRequests.length > 0 ? (
              <div className="border border-stone-100 rounded-2xl overflow-hidden bg-white divide-y divide-stone-100 shadow-sm">
                {changeRequests.map((req) => {
                  const typeLabel =
                    CHANGE_TYPES.find((t) => t.value === req.changeType)?.label ?? req.changeType
                  return (
                    <div key={req.id} className="p-4 flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {req.status === 'approved' && (
                          <CheckCircle2 size={16} className="text-green-500" />
                        )}
                        {req.status === 'rejected' && (
                          <XCircle size={16} className="text-destructive" />
                        )}
                        {req.status === 'pending' && (
                          <Clock size={16} className="text-yellow-500 animate-pulse" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-stone-700">{typeLabel}</p>
                        {req.requestedData?.field ? (
                          <p className="text-xs text-stone-500 mt-1">
                            <span className="font-medium text-stone-400">
                              {getFieldLabel(req.requestedData.field)}:
                            </span>{' '}
                            <span className="line-through text-stone-400">
                              {req.requestedData.currentValue || '—'}
                            </span>{' '}
                            →{' '}
                            <span className="font-semibold text-stone-700">
                              {req.requestedData.requestedValue}
                            </span>
                          </p>
                        ) : (
                          req.requestedData?.notes && (
                            <p className="text-xs text-stone-500 mt-1 italic">
                              "{req.requestedData.notes}"
                            </p>
                          )
                        )}
                        {req.reviewComments && (
                          <p className="text-xs text-stone-400 bg-stone-50 p-2.5 rounded-lg border border-stone-100/60 mt-2">
                            <span className="font-semibold text-stone-500">
                              HR Review Comments:
                            </span>{' '}
                            "{req.reviewComments}"
                          </p>
                        )}
                        <p className="text-[10px] text-stone-400 mt-2">
                          Submitted on {new Date(req.submittedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge
                        variant={
                          req.status === 'approved'
                            ? 'success'
                            : req.status === 'rejected'
                              ? 'error'
                              : 'secondary'
                        }
                        className="capitalize text-[9px] shrink-0 font-bold px-2 py-0.5"
                      >
                        {req.status}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-stone-100 p-6 text-center shadow-sm">
                <Clock size={28} className="text-stone-300 mx-auto mb-2" />
                <p className="text-xs text-stone-400 font-medium">
                  No profile changes submitted yet.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
