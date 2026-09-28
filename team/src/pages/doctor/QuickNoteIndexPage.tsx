import { formatDistanceToNow } from 'date-fns'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { QuickNoteSheet } from '@/shared/components/quick-note-sheet'

interface RecentNote {
  id: string
  patientName: string
  body: string
  tags: string[]
  createdAt: string
}

export default function DoctorQuickNoteIndexPage() {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<RecentNote[]>([])

  const handleSubmit = (note: { patientId: string; body: string; tags: string[] }) => {
    // API call is fired inside QuickNoteSheet; this updates local session list
    setNotes((prev) => [
      {
        id: `qn_${Date.now()}`,
        patientName: 'Patient',
        body: note.body,
        tags: note.tags,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ])
  }

  return (
    <div className="p-5 pb-8 space-y-5">
      <div className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight">Quick notes</h1>
        <p className="text-sm text-muted-foreground">Capture observations between patients.</p>
      </div>

      <Button className="w-full" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> New quick note
      </Button>

      {notes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            This session
          </p>
          {notes.map((n) => (
            <Card key={n.id}>
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold truncate">{n.patientName}</p>
                  <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">{n.body}</p>
                {n.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {n.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {notes.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No notes this session. Use the button above to add one.
          </CardContent>
        </Card>
      )}

      <QuickNoteSheet open={open} onOpenChange={setOpen} onSubmit={handleSubmit} />
    </div>
  )
}
