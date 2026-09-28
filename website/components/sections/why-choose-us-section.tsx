'use client'

import { CircleStar as AnimatedCircleStar } from '@/components/animate-ui/icons/circle-star'
import { MessageCircleHeart } from '@/components/animate-ui/icons/message-circle-heart'
import { Sparkles as AnimatedSparkles } from '@/components/animate-ui/icons/sparkles'

export default function WhyChooseUsSection() {
  return (
    <section id="why-us" className="bg-gray-50 px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-4xl font-bold text-gray-900">Why Choose Us</h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            Experience the difference of exceptional dental care
          </p>
        </div>

        {/* Feature 1 */}
        <div className="mb-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex items-center justify-center h-80 w-full">
            <div className="flex items-center justify-center rounded-full bg-[#F6EFE1] p-8">
              <AnimatedCircleStar
                size={120}
                className="text-[#B8873A]"
                animateOnView
                animateOnHover
                loop
              />
            </div>
          </div>
          <div>
            <h3 className="mb-4 text-3xl font-bold text-gray-900">Expert Team</h3>
            <p className="mb-4 text-lg leading-relaxed text-gray-600">
              Our experienced dentists use the latest technology and techniques for optimal results.
              With years of combined experience, our team is dedicated to providing you with the
              highest quality dental care.
            </p>
            <p className="text-lg leading-relaxed text-gray-600">
              We stay current with continuing education and the latest advancements in dental
              technology to ensure you receive the best possible treatment.
            </p>
          </div>
        </div>

        {/* Feature 2 */}
        <div className="mb-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="order-2 lg:order-1">
            <h3 className="mb-4 text-3xl font-bold text-gray-900">Patient-Centered Care</h3>
            <p className="mb-4 text-lg leading-relaxed text-gray-600">
              We listen to your concerns and create personalized treatment plans for your unique
              needs. Every patient is different, and we take the time to understand your goals and
              preferences.
            </p>
            <p className="text-lg leading-relaxed text-gray-600">
              Our compassionate approach ensures that you feel comfortable and informed throughout
              your dental journey, from consultation to treatment completion.
            </p>
          </div>
          <div className="order-1 lg:order-2 flex items-center justify-center h-80 w-full">
            <div className="flex items-center justify-center rounded-full bg-[#F6EFE1] p-8">
              <MessageCircleHeart
                size={120}
                className="text-[#B8873A]"
                animateOnView
                animateOnHover
                loop
              />
            </div>
          </div>
        </div>

        {/* Feature 3 */}
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex items-center justify-center h-80 w-full">
            <div className="flex items-center justify-center rounded-full bg-[#F6EFE1] p-8">
              <AnimatedSparkles
                size={120}
                className="text-[#B8873A]"
                animateOnView
                animateOnHover
                loop
              />
            </div>
          </div>
          <div>
            <h3 className="mb-4 text-3xl font-bold text-gray-900">Modern Facility</h3>
            <p className="mb-4 text-lg leading-relaxed text-gray-600">
              State-of-the-art equipment and a comfortable environment for a pleasant dental
              experience. Our clinic features the latest in dental technology and design.
            </p>
            <p className="text-lg leading-relaxed text-gray-600">
              From digital X-rays to advanced sterilization protocols, we maintain the highest
              standards to ensure your safety and comfort during every visit.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
