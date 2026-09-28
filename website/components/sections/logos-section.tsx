// The original template listed another clinic's insurance partners (Glico, ACE
// Medical, Nationwide, MH) with their logos — deliberately removed so Denel
// doesn't claim partnerships it hasn't confirmed. Restore an `insurancePartners`
// array + carousel here once Denel Dental Clinic's accepted insurers are known.
export default function LogosSection() {
  return (
    <section id="insurance-partners" className="bg-white px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-4xl font-bold text-gray-900">Our Insurance Partners</h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            We aim to make quality dental care affordable. Accepted insurance plans will be listed
            here soon.
          </p>
        </div>
      </div>
    </section>
  )
}
