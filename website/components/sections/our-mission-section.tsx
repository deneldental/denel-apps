'use client'

import Image from 'next/image'

export default function OurMissionSection() {
  return (
    <section id="about-us" className="bg-white px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="order-1 lg:order-2">
            <h2 className="mb-4 text-4xl font-bold text-gray-900">Our Mission</h2>
            <p className="mb-4 text-lg text-gray-600">
              Our mission is to provide exceptional dental care to our patients, using the latest
              technology and techniques to achieve optimal results. We are committed to helping
              patients achieve and maintain healthy, beautiful smiles.
            </p>
          </div>
          <div className="order-1 lg:order-2">
            <div className="relative h-96 sm:h-128 overflow-hidden rounded-2xl shadow-lg">
              <Image
                src="/bg04.jpg"
                alt="Denel Dental Clinic team and facility"
                fill
                className="object-cover"
                sizes="(min-width: 1024px) 48vw, 100vw"
                priority
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
