import { Loader2, Paperclip, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { staffApi } from '@/lib/api'
import type { StaffRequest } from './request-shared'

/**
 * Bottom-sheet form for filing a suggestion. Replaces the old inline card form
 * on the combined requests/suggestions page. On success it hands the created
 * suggestion back so the list can update immediately.
 */
export function SuggestionSheet({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted: (created: StaffRequest) => void
}) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Reset when the sheet closes.
  useEffect(() => {
    if (!open) {
      setText('')
      setFile(null)
      setError('')
      setSubmitting(false)
    }
  }, [open])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('')
    const picked = e.target.files?.[0]
    if (!picked) return
    if (picked.size > 5 * 1024 * 1024) {
      setError('File size must not exceed 5MB')
      e.target.value = ''
      return
    }
    setFile(picked)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!text.trim()) {
      setError('Please enter a suggestion description')
      return
    }

    setSubmitting(true)
    try {
      let uploaded: { name: string; url: string }[] = []
      if (file) {
        const up = await staffApi.uploadAttachment(file)
        const url = (up as { url?: string }).url
        if (!up.success || !url) throw new Error(up.error || 'Upload failed')
        uploaded = [{ name: file.name, url }]
      }

      const res = await staffApi.submitRequest({
        requestType: 'suggestion',
        reason: text.trim(),
        attachments: uploaded,
      })

      if (res.success && res.data) {
        toast.success('Suggestion submitted')
        onSubmitted(res.data as StaffRequest)
        onOpenChange(false)
      } else {
        setError(res.error || 'Failed to submit suggestion')
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during submission')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[85vh] flex flex-col p-0 gap-0"
        aria-describedby={undefined}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-3">
          <SheetTitle>Submit a Suggestion</SheetTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive leading-snug">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="suggestion">Your Suggestion / Feedback *</Label>
              <Textarea
                id="suggestion"
                placeholder="Share your thoughts, suggestions, or ideas..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                className="rounded-xl border-stone-200 bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="suggestion-file">Attachment (Optional, Max 5MB)</Label>
              {file ? (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-stone-200 bg-white shadow-2xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip size={16} className="text-muted-foreground shrink-0" />
                    <span className="text-xs truncate font-medium text-foreground">
                      {file.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      ({(file.size / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setFile(null)}
                    aria-label="Remove attachment"
                  >
                    <X size={16} />
                  </Button>
                </div>
              ) : (
                <label
                  htmlFor="suggestion-file"
                  className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 bg-white px-4 py-6 text-center cursor-pointer hover:bg-stone-50/80 transition-all duration-200"
                >
                  <Paperclip size={20} className="text-stone-400" />
                  <span className="text-xs font-semibold text-stone-700">
                    Attach a file or image
                  </span>
                  <span className="text-[10px] text-muted-foreground">PDF, PNG, JPG (max 5MB)</span>
                  <input
                    id="suggestion-file"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 z-10 border-t bg-background px-4 py-3 flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="animate-spin mr-1.5" size={16} />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="mr-1.5" size={16} />
                  Submit
                </>
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
