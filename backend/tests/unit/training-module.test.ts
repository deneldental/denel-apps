import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../../src/db'
import { trainingMaterials, user } from '../../src/db/schema'

const DATABASE_URL = process.env.DATABASE_URL

describe.skipIf(!DATABASE_URL)('Training Module System', () => {
  let adminUser: typeof user.$inferSelect | undefined
  let db: ReturnType<typeof getDb>

  beforeAll(async () => {
    db = getDb(DATABASE_URL as string)
    adminUser = await db.query.user.findFirst({
      where: eq(user.role, 'admin'),
    })
  })

  it('should create a training module with blocks and quiz', async () => {
    if (!adminUser) return

    const title = `Test Module ${Date.now()}`
    const [inserted] = await db
      .insert(trainingMaterials)
      .values({
        title,
        description: 'Test Description',
        materialType: 'module',
        blocks: [{ id: '1', type: 'section', title: 'Intro', content: 'Hello' }],
        quizTimer: 10,
        quizQuestions: [
          {
            id: 'q1',
            text: 'Q1',
            questionType: 'multichoice',
            options: ['A', 'B'],
            correctAnswerIndex: 0,
            orderIndex: 0,
          },
        ],
        uploadedById: adminUser.id,
        published: true,
        publishedAt: new Date(),
      })
      .returning()

    expect(inserted).toBeDefined()
    expect(inserted.title).toBe(title)
    expect(inserted.blocks).toHaveLength(1)
    expect(inserted.quizTimer).toBe(10)
    expect(inserted.quizQuestions).toHaveLength(1)
    expect(inserted.published).toBe(true)
    expect(inserted.publishedAt).toBeDefined()

    // Cleanup
    await db.delete(trainingMaterials).where(eq(trainingMaterials.id, inserted.id))
  })

  it('should update a training module', async () => {
    if (!adminUser) return

    const [inserted] = await db
      .insert(trainingMaterials)
      .values({
        title: 'Update Me',
        materialType: 'module',
        uploadedById: adminUser.id,
      })
      .returning()

    const [updated] = await db
      .update(trainingMaterials)
      .set({ title: 'Updated Title', quizTimer: 5 })
      .where(eq(trainingMaterials.id, inserted.id))
      .returning()

    expect(updated.title).toBe('Updated Title')
    expect(updated.quizTimer).toBe(5)

    // Cleanup
    await db.delete(trainingMaterials).where(eq(trainingMaterials.id, inserted.id))
  })
})
