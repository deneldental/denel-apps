import Image from 'next/image'

export default function OurStorySection() {
  return (
    <section id="about-us" className="bg-white px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="order-1 lg:order-2">
            <h2 className="mb-4 text-4xl font-bold text-gray-900">Our Story</h2>
            <p className="mb-4 text-lg text-gray-600">
              Denel Dental Clinic brings modern, compassionate dental care to every patient who
              walks through our doors. Our team pairs up-to-date clinical expertise with a genuine
              commitment to your comfort, using the latest technology and techniques to help you
              achieve and maintain a healthy, confident smile.
              <br />
              <br />
              From routine check-ups to specialist treatment, we're dedicated to making quality
              dental care approachable and stress-free for you and your family.
            </p>
          </div>
          <div className="order-1 lg:order-2">
            <div className="relative h-96 sm:h-128 overflow-hidden rounded-2xl shadow-lg">
              <Image
                src="/bg03.jpg"
                alt="Denel Dental Clinic"
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
