'use client'

import { Award, Clock, Heart, Shield, Sparkles, Users } from 'lucide-react'
import { motion } from 'motion/react'
import Image from 'next/image'

const values = [
  {
    icon: Heart,
    title: 'Compassionate Care',
    description:
      'We treat every patient with empathy, respect, and genuine concern for their well-being.',
  },
  {
    icon: Shield,
    title: 'Excellence in Service',
    description:
      'We maintain the highest standards of dental care using the latest techniques and technology.',
  },
  {
    icon: Sparkles,
    title: 'Innovation',
    description:
      'We continuously invest in advanced equipment and training to provide cutting-edge treatments.',
  },
  {
    icon: Users,
    title: 'Patient-Centered',
    description: 'Your comfort, needs, and goals are at the heart of everything we do.',
  },
  {
    icon: Award,
    title: 'Quality Results',
    description: 'We are committed to delivering exceptional outcomes that exceed expectations.',
  },
  {
    icon: Clock,
    title: 'Timely Service',
    description: 'We respect your time with efficient scheduling and prompt, thorough care.',
  },
]

export default function About1Section() {
  return (
    <section className="bg-gray-50 px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        {/* Mission Statement */}
        <div className="mb-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="relative h-96 w-full overflow-hidden rounded-2xl shadow-lg">
            <Image
              src="/bg01.jpg"
              alt="Denel Dental Clinic"
              fill
              className="object-cover"
              sizes="(min-width: 1024px) 50vw, 100vw"
            />
          </div>
          <div>
            <h2 className="mb-6 text-4xl font-bold text-gray-900">Our Mission & Values</h2>
            <p className="mb-4 text-lg leading-relaxed text-gray-700">
              At Denel Dental Clinic, our mission is to provide exceptional dental care that
              transforms lives through healthy, beautiful smiles. We believe in building lasting
              relationships with our patients based on trust, respect, and uncompromising quality.
            </p>
            <p className="mb-6 text-lg leading-relaxed text-gray-700">
              Every day, we strive to exceed expectations by combining advanced technology with
              personalized care, ensuring each patient receives the attention and treatment they
              deserve.
            </p>
            <div className="flex flex-wrap gap-4">
              <div className="rounded-lg bg-[#F6EFE1] px-4 py-2">
                <span className="text-sm font-semibold text-[#24296A]">Patient-First</span>
              </div>
              <div className="rounded-lg bg-[#F6EFE1] px-4 py-2">
                <span className="text-sm font-semibold text-[#24296A]">Excellence</span>
              </div>
              <div className="rounded-lg bg-[#F6EFE1] px-4 py-2">
                <span className="text-sm font-semibold text-[#24296A]">Innovation</span>
              </div>
              <div className="rounded-lg bg-[#F6EFE1] px-4 py-2">
                <span className="text-sm font-semibold text-[#24296A]">Integrity</span>
              </div>
            </div>
          </div>
        </div>

        {/* Core Values Grid */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {values.map((value, index) => {
            const IconComponent = value.icon
            return (
              <motion.div
                key={value.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                viewport={{ once: true, amount: 0.3 }}
                className="rounded-xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-[#F6EFE1]">
                  <IconComponent className="h-6 w-6 text-[#B8873A]" />
                </div>
                <h3 className="mb-2 text-xl font-semibold text-gray-900">{value.title}</h3>
                <p className="text-gray-600">{value.description}</p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
