'use client'

import { Button } from '@/components/ui/button'

export default function CTASection() {
  return (
    <section id="contact" className="bg-[#B8873A] px-4 py-16 text-[#24296A]">
      <div className="container mx-auto max-w-4xl text-center">
        <h2 className="mb-4 text-4xl font-bold text-[#24296A]">Ready to Transform Your Smile?</h2>
        <p className="mb-8 text-xl text-[#24296A]">
          Schedule your appointment today and take the first step toward better oral health.
        </p>
        <Button size="lg" variant="secondary" className="text-lg text-[#24296A]">
          <a href="/appointments" className="text-base">
            Book Your Appointment
          </a>
        </Button>
      </div>
    </section>
  )
}
