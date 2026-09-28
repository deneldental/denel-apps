import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { QuizQuestion } from '@/features/trainer/QuizQuestionsEditor'
import { trainerApi } from '@/lib/actions/trainer'

export type ContentBlock =
  | { id: string; type: 'section'; title: string; content: string }
  | { id: string; type: 'divider' }

export interface TrainingModule {
  id: string
  title: string
  description: string | null
  materialType: 'module' | 'quiz' | string
  published: boolean
  blocks: ContentBlock[] | null
  assignedTo: string[] | null
  quizQuestions?: QuizQuestion[]
  quizTimer?: number | null
  passingScore?: number | null
  allowReassessment?: boolean
}

export interface Learner {
  id: string
  name: string
  email: string
}

export function useModuleDetail(id: string, onDeleted: () => void) {
  const [module, setModule] = useState<TrainingModule | null>(null)
  const [loading, setLoading] = useState(true)
  const [blocks, setBlocks] = useState<ContentBlock[]>([])
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [timer, setTimer] = useState<number | null>(null)
  const [passingScore, setPassingScore] = useState<number | null>(null)
  const [questionsDirty, setQuestionsDirty] = useState(false)
  const [questionsSaving, setQuestionsSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [learners, setLearners] = useState<Learner[]>([])
  const [learnersLoading, setLearnersLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    trainerApi
      .getModule(id)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) {
          const m = res.data as TrainingModule
          setModule(m)
          setBlocks((m.blocks ?? []) as ContentBlock[])
          setQuestions((m.quizQuestions ?? []) as QuizQuestion[])
          setTimer(m.quizTimer ?? null)
          setPassingScore(m.passingScore ?? null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  /**
   * Save the module body as a single BlockNote-authored HTML document, stored
   * as one section block. Keeps the existing `blocks` storage + learner viewer
   * working (it renders section HTML) — no migration, no viewer rewrite.
   */
  async function saveContentHtml(html: string) {
    const updated: ContentBlock[] = [{ id: 'content', type: 'section', title: '', content: html }]
    const res = await trainerApi.updateModule(id, { blocks: updated })
    if (!res.success) throw new Error(res.error ?? 'Failed to save')
    setBlocks(updated)
  }

  async function togglePublish() {
    if (!module) return
    const next = !module.published
    setPublishing(true)
    try {
      const res = await trainerApi.updateModule(id, { published: next })
      if (!res.success) throw new Error(res.error ?? 'Failed to update status')
      setModule((m) => (m ? { ...m, published: next } : m))
      toast.success(next ? 'Published' : 'Unpublished')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setPublishing(false)
    }
  }

  async function saveEdit(title: string, desc: string, allowReassessment: boolean) {
    const nextTitle = title.trim()
    if (!nextTitle) {
      toast.error('Title is required')
      throw new Error('title required')
    }
    const res = await trainerApi.updateModule(id, {
      title: nextTitle,
      description: desc.trim() || null,
      allowReassessment,
    })
    if (!res.success) throw new Error(res.error ?? 'Failed to save')
    setModule((m) =>
      m ? { ...m, title: nextTitle, description: desc.trim() || null, allowReassessment } : m
    )
    toast.success('Saved')
  }

  async function saveQuestions() {
    setQuestionsSaving(true)
    try {
      const res = await trainerApi.updateModule(id, {
        quizQuestions: questions,
        quizTimer: timer,
        passingScore,
      })
      if (!res.success) throw new Error(res.error ?? 'Failed to save')
      setQuestionsDirty(false)
      toast.success('Questions saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setQuestionsSaving(false)
    }
  }

  async function handleDelete() {
    if (!module) return
    setDeleting(true)
    try {
      const res = await trainerApi.deleteModule(id)
      if (!res.success) throw new Error(res.error ?? 'Failed to delete')
      toast.success(`${module.title} deleted`)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
      setDeleting(false)
    }
  }

  async function loadLearners() {
    if (learners.length > 0) return
    setLearnersLoading(true)
    try {
      const res = await trainerApi.getLearners()
      if (res.success && Array.isArray(res.data)) {
        setLearners(res.data as Learner[])
      } else {
        toast.error(res.error ?? 'Failed to load learners')
      }
    } finally {
      setLearnersLoading(false)
    }
  }

  async function assignAll() {
    const res = await trainerApi.updateModule(id, { assignedTo: ['all'] })
    if (!res.success) throw new Error(res.error ?? 'Failed to assign')
    setModule((m) => (m ? { ...m, assignedTo: ['all'] } : m))
    toast.success('Assigned to all learners')
  }

  async function assignSpecific(ids: string[]) {
    const res = await trainerApi.updateModule(id, { assignedTo: ids })
    if (!res.success) throw new Error(res.error ?? 'Failed to assign')
    setModule((m) => (m ? { ...m, assignedTo: ids } : m))
    toast.success(`Assigned to ${ids.length} learner${ids.length === 1 ? '' : 's'}`)
  }

  return {
    module,
    loading,
    blocks,
    questions,
    timer,
    passingScore,
    questionsDirty,
    questionsSaving,
    publishing,
    deleting,
    learners,
    learnersLoading,
    saveContentHtml,
    togglePublish,
    saveEdit,
    saveQuestions,
    handleDelete,
    loadLearners,
    assignAll,
    assignSpecific,
    setQuestions,
    setTimer,
    setPassingScore,
    setQuestionsDirty,
  }
}
