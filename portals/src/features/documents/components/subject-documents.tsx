import { Check, CheckCircle2, Copy, FileText, PenLine, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  createDocInstance,
  type DocTemplate,
  getDocTemplates,
  getSubjectDocuments,
  uploadSignedDocument,
} from '@/lib/actions/documents'
import { useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { DocumentSigner } from './document-signer'

// Shared with templates-manager.tsx (same literal value) so both surfaces
// read/refresh the same templates cache.
const DOC_TEMPLATES_KEY = ['documents', 'templates'] as const

/**
 * Reusable per-subject document panel (admin-v1 CC.4). Fill + sign a template
 * digitally, or record a pre-signed scan (upload path), and list the subject's
 * completed documents.
 */
export function SubjectDocuments({
  subjectType,
  subjectId,
  subjectName,
}: {
  subjectType: string
  subjectId: string
  subjectName: string
}) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [signing, setSigning] = useState<DocTemplate | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [configuringTemplate, setConfiguringTemplate] = useState<DocTemplate | null>(null)
  const [signingOrder, setSigningOrder] = useState<'SEQUENTIAL' | 'PARALLEL'>('SEQUENTIAL')
  const [signerInputs, setSignerInputs] = useState<
    Array<{ role: string; name: string; email: string }>
  >([])
  const [generatedLinks, setGeneratedLinks] = useState<Array<{
    name: string
    email: string
    magicLink: string
  }> | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  // No shared query-key group exists for per-subject document instances —
  // local literal, module-scoped, keyed by subject so switching subjects
  // (e.g. a different selected patient) fetches its own list.
  const {
    data: docs = [],
    isLoading: loading,
    refetch: load,
  } = useApiQuery(['documents', 'subject', subjectType, subjectId] as const, () =>
    getSubjectDocuments(subjectType, subjectId)
  )

  const { data: templates = [] } = useApiQuery(DOC_TEMPLATES_KEY, () => getDocTemplates())

  useEffect(() => {
    if (!configuringTemplate) return
    const roles = Array.from(
      new Set((configuringTemplate.fields || []).map((f: any) => f.signerRole).filter(Boolean))
    )
    const finalRoles = roles.length > 0 ? roles : ['patient']

    setSignerInputs(
      finalRoles.map((role) => ({
        role: String(role),
        name: role === 'patient' || role === 'subject' ? subjectName : '',
        email: '',
      }))
    )
  }, [configuringTemplate, subjectName])

  async function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file || !title.trim()) {
      toast.error('Pick a file and enter a title.')
      return
    }
    const form = new FormData()
    form.append('file', file)
    form.append('subjectType', subjectType)
    form.append('subjectId', subjectId)
    form.append('title', title.trim())
    setBusy(true)
    const res = await uploadSignedDocument(form)
    setBusy(false)
    if (res.success) {
      toast.success('Document recorded')
      setTitle('')
      if (fileRef.current) fileRef.current.value = ''
      load()
    } else toast.error(res.error || 'Upload failed')
  }

  if (signing) {
    return (
      <DocumentSigner
        template={signing}
        subjectType={subjectType}
        subjectId={subjectId}
        subjectName={subjectName}
        onDone={() => {
          setSigning(null)
          load()
        }}
        onCancel={() => setSigning(null)}
      />
    )
  }

  return (
    <div className="space-y-4">
      {templates.length > 0 && (
        <div className="space-y-2 rounded-lg border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <PenLine className="h-4 w-4" /> Fill & sign a template
          </p>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <Button
                key={t.id}
                variant="outline"
                size="sm"
                onClick={() => setConfiguringTemplate(t)}
              >
                {t.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-lg border p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Upload className="h-4 w-4" /> Record a signed document
        </p>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title (e.g. Ortho consent)"
        />
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="block text-sm"
        />
        <Button onClick={upload} disabled={busy} size="sm">
          {busy ? 'Uploading…' : 'Upload signed scan'}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.mode} · {d.status}
                    {d.completedAt ? ` · ${new Date(d.completedAt).toLocaleDateString()}` : ''}
                  </p>
                </div>
              </div>
              {d.signedPdfUrl && (
                <a
                  href={d.signedPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  View
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Configure Signers Dialog */}
      <Dialog open={!!configuringTemplate} onOpenChange={(o) => !o && setConfiguringTemplate(null)}>
        <DialogContent className="max-w-md bg-background">
          <DialogHeader>
            <DialogTitle>Configure Signers: {configuringTemplate?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-left">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">
                Signing Order
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={signingOrder === 'SEQUENTIAL'}
                    onChange={() => setSigningOrder('SEQUENTIAL')}
                    className="h-4 w-4 accent-sky-600"
                  />
                  <span>Sequential (one after another)</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={signingOrder === 'PARALLEL'}
                    onChange={() => setSigningOrder('PARALLEL')}
                    className="h-4 w-4 accent-sky-600"
                  />
                  <span>Parallel (any order)</span>
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                Signer Details
              </label>
              {signerInputs.map((input, idx) => (
                <div
                  key={input.role}
                  className="p-3 border border-slate-100 bg-slate-50/50 rounded-lg space-y-2"
                >
                  <span className="text-xs font-bold text-sky-700 capitalize bg-sky-50 px-2 py-0.5 rounded">
                    Role: {input.role}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-500 font-medium block">Name</label>
                      <Input
                        value={input.name}
                        onChange={(e) => {
                          const updated = [...signerInputs]
                          updated[idx].name = e.target.value
                          setSignerInputs(updated)
                        }}
                        placeholder="John Doe"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 font-medium block">Email</label>
                      <Input
                        value={input.email}
                        onChange={(e) => {
                          const updated = [...signerInputs]
                          updated[idx].email = e.target.value
                          setSignerInputs(updated)
                        }}
                        placeholder="john@example.com"
                        type="email"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfiguringTemplate(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!configuringTemplate) return
                const invalid = signerInputs.some((s) => !s.name.trim() || !s.email.trim())
                if (invalid) {
                  toast.error('Please enter name and email for all signers.')
                  return
                }

                setBusy(true)
                try {
                  const res = await createDocInstance({
                    templateId: configuringTemplate.id,
                    subjectType,
                    subjectId,
                    title: configuringTemplate.name,
                    signingOrder,
                    signers: signerInputs.map((s, idx) => ({
                      role: s.role,
                      name: s.name.trim(),
                      email: s.email.trim(),
                      order: idx + 1,
                    })),
                  })

                  if (res.success && res.data) {
                    toast.success('Document created & links generated')
                    setGeneratedLinks(res.data.signers || [])
                    setConfiguringTemplate(null)
                    load()
                  } else {
                    toast.error(res.error || 'Failed to generate links')
                  }
                } catch (err: any) {
                  toast.error(err.message || 'Error occurred')
                } finally {
                  setBusy(false)
                }
              }}
              disabled={busy}
            >
              {busy ? 'Generating…' : 'Generate Magic Links'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generated Links Dialog */}
      <Dialog open={!!generatedLinks} onOpenChange={(o) => !o && setGeneratedLinks(null)}>
        <DialogContent className="max-w-md bg-background">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" /> Signing Links Generated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-left">
            <p className="text-xs text-slate-500">
              Copy and share these private links with each signer. E-Signature collection will
              update in real-time.
            </p>
            <div className="space-y-3">
              {generatedLinks?.map((link, idx) => (
                <div
                  key={link.email}
                  className="p-3 border border-slate-200 bg-background rounded-lg space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">{link.name}</span>
                    <span className="text-[10px] text-slate-400">{link.email}</span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={link.magicLink}
                      readOnly
                      className="h-8 text-xs bg-slate-50 text-slate-600 select-all font-mono"
                    />
                    <Button
                      size="sm"
                      className="h-8 px-2.5"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(link.magicLink)
                        toast.success('Link copied to clipboard')
                        setCopiedIndex(idx)
                        setTimeout(() => setCopiedIndex(null), 2000)
                      }}
                    >
                      {copiedIndex === idx ? (
                        <Check className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setGeneratedLinks(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
