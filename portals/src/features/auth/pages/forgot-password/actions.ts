import { api } from '@/lib/api-client'

export async function requestForgotOtp(phone: string) {
  const res = await api.post<{ success: boolean; message: string }>(
    '/api/staff-portal/forgot-password/request-otp',
    {
      phone,
    }
  )
  return { success: res.success, error: res.error, message: res.data?.message }
}

export async function verifyForgotOtp(phone: string, code: string) {
  const res = await api.post<{ success: boolean; resetToken: string }>(
    '/api/staff-portal/forgot-password/verify-otp',
    {
      phone,
      code,
    }
  )
  return { success: res.success, error: res.error, resetToken: res.data?.resetToken }
}

export async function resetForgotPassword(resetToken: string, newPassword: string) {
  const res = await api.post<{ success: boolean }>('/api/staff-portal/forgot-password/reset', {
    resetToken,
    newPassword,
  })
  return { success: res.success, error: res.error }
}
