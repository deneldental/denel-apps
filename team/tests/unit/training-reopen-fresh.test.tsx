/**
 * Training → reopening a module already in progress. The page used to open it
 * from the copy loaded when the page first opened, so after an hour its images
 * and videos (private links, valid for about an hour) failed to load. It now
 * opens the module from freshly loaded data.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  staffApi: { getTraining: vi.fn(), updateProgress: vi.fn(), submitQuiz: vi.fn() },
}))
vi.mock('@/components/training/TrainingModuleViewer', () => ({
  TrainingModuleViewer: ({ module }: { module: { blocks?: { content?: string }[] } }) => (
    <div data-testid="viewer">{module.blocks?.map((b) => b.content).join('')}</div>
  ),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { staffApi } from '@/lib/api'
import TrainingPage from '@/pages/TrainingPage'

afterEach(() => vi.clearAllMocks())

const image = (window: string) =>
  `https://denel-private.acct.r2.cloudflarestorage.com/training/hand-hygiene.png?X-Amz-Date=20260927T${window}00Z`

const training = (window: string) => ({
  success: true,
  data: [
    {
      id: 'tp-1',
      status: 'in_progress',
      progressPercent: 40,
      training: {
        id: 't-1',
        title: 'Hand hygiene',
        materialType: 'module',
        isMandatory: true,
        published: true,
        blocks: [
          { id: 'b-1', type: 'section', title: 'Steps', content: `<img src="${image(window)}">` },
        ],
      },
    },
  ],
})

describe('Reopening a training module in progress', () => {
  it('opens it with freshly loaded links', async () => {
    vi.mocked(staffApi.getTraining).mockResolvedValue(training('0900') as never)
    render(
      <MemoryRouter>
        <TrainingPage />
      </MemoryRouter>
    )
    const card = await screen.findByText('Hand hygiene')

    vi.mocked(staffApi.getTraining).mockResolvedValue(training('1100') as never)
    fireEvent.click(card)

    await waitFor(() => expect(screen.getByTestId('viewer').innerHTML).toContain(image('1100')))
  })
})
