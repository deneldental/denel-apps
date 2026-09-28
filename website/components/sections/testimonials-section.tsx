// Patient reviews will be added once Denel Dental Clinic has its own. The
// original template shipped another clinic's named testimonials — deliberately
// removed. Restore a `testimonials` array + cards here with real Denel reviews.
export default function TestimonialsSection() {
  return (
    <section id="testimonials" className="bg-gray-50 px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-4xl font-bold text-gray-900">What Our Patients Say</h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            Stories from Denel Dental Clinic patients will appear here soon.
          </p>
        </div>
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
          <p className="text-lg font-medium text-gray-500">Patient reviews are coming soon.</p>
        </div>
      </div>
    </section>
  )
}
