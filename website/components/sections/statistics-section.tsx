// The original template shipped another clinic's figures (2,500+ patients, "3+
// years", founded 2022, etc.) — deliberately removed so Denel doesn't publish
// numbers it can't stand behind. Restore the animated StatCounter cards here
// with real Denel Dental Clinic figures when they're available.
export default function StatisticsSection() {
  return (
    <section id="statistic" className="bg-gray-50 px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="text-4xl font-bold text-gray-900">Our Statistics</h2>
        </div>
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
          <p className="text-lg font-medium text-gray-500">
            Denel Dental Clinic's figures will be shared here soon.
          </p>
        </div>
      </div>
    </section>
  )
}
