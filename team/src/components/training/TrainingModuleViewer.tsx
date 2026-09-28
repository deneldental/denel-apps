import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Play } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { sanitizeHtml } from '@/lib/sanitize'
import { cn } from '@/lib/utils'
import { BLOCKNOTE_CONTENT_CLASS } from '@/shared/lib/blocknote-content'

interface TrainingModuleViewerProps {
  module: any
  progress: any
  onStartQuiz: () => void
  onBack: () => void
}

export function TrainingModuleViewer({ module, onStartQuiz, onBack }: TrainingModuleViewerProps) {
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0)
  const blocks = module.blocks || []
  const hasQuiz = (module.quizQuestions?.length || 0) > 0

  const isLastBlock = currentBlockIndex === blocks.length - 1
  const progressPercent =
    blocks.length > 0 ? Math.round(((currentBlockIndex + 1) / blocks.length) * 100) : 100

  return (
    <div className="flex flex-col h-full bg-background animate-in slide-in-from-right duration-300">
      <div className="shrink-0 p-4 border-b flex items-center justify-between sticky top-0 bg-background z-10">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Go back">
          <ArrowLeft size={20} />
        </Button>
        <div className="flex-1 px-4 text-center">
          <h2 className="font-bold text-sm line-clamp-1">{module.title}</h2>
          {blocks.length > 1 && (
            <div className="flex items-center justify-center gap-2 mt-0.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
                SECTION {currentBlockIndex + 1} OF {blocks.length}
              </span>
            </div>
          )}
        </div>
        <div className="w-10" />
      </div>

      <Progress value={progressPercent} className="h-1 shrink-0 rounded-none" />

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="p-5 pb-24 space-y-6 min-w-0">
          {blocks.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <BookOpen size={40} className="mx-auto opacity-20" />
              <p className="text-sm text-muted-foreground">This module has no content sections.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {blocks[currentBlockIndex].type === 'section' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-primary">
                    {blocks[currentBlockIndex].title}
                  </h3>
                  <div
                    className={cn('text-[15px] text-muted-foreground', BLOCKNOTE_CONTENT_CLASS)}
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(blocks[currentBlockIndex].content),
                    }}
                  />
                </div>
              )}
              {blocks[currentBlockIndex].type === 'divider' && (
                <hr className="border-dashed my-8" />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 p-4 border-t bg-background/80 backdrop-blur-sm flex gap-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => setCurrentBlockIndex((prev) => Math.max(0, prev - 1))}
          disabled={currentBlockIndex === 0}
        >
          Previous
        </Button>

        {!isLastBlock ? (
          <Button
            className="flex-1 gap-2"
            onClick={() => setCurrentBlockIndex((prev) => Math.min(blocks.length - 1, prev + 1))}
          >
            Next <ChevronRight size={16} />
          </Button>
        ) : hasQuiz ? (
          <Button
            className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={onStartQuiz}
          >
            Start Assessment <Play size={16} fill="currentColor" />
          </Button>
        ) : (
          <Button
            className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={onBack}
          >
            Complete Module <CheckCircle2 size={16} />
          </Button>
        )}
      </div>
    </div>
  )
}
