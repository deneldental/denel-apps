// Team profiles will be added once Denel Dental Clinic's staff content is ready.
// The original template shipped another clinic's real staff (names, photos,
// LinkedIn) — deliberately removed. Restore a `teamMembers` array + cards here
// when Denel's own team photos and details exist.
export default function TeamSection() {
  return (
    <section id="team" className="bg-white px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-4xl font-bold text-gray-900">Meet Our Team</h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            Our experienced and compassionate team is dedicated to providing you with the best
            dental care.
          </p>
        </div>
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-16 text-center">
          <p className="text-lg font-medium text-gray-500">Our team profiles are coming soon.</p>
        </div>
      </div>
    </section>
  )
}
