'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import AboutUsSection from '@/components/sections/about-us-section'
import CTASection from '@/components/sections/cta-section'
import FAQSection from '@/components/sections/faq-section'
import HeroSection from '@/components/sections/hero-section'
import LogosSection from '@/components/sections/logos-section'
import ServicesSection from '@/components/sections/services-section'
import StatisticsSection from '@/components/sections/statistics-section'
import TeamSection from '@/components/sections/team-section'
import TestimonialsSection from '@/components/sections/testimonials-section'
import WhyChooseUsSection from '@/components/sections/why-choose-us-section'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col text-base sm:text-lg leading-relaxed text-gray-900">
      <NavigationMenuDemo />
      <HeroSection />
      <LogosSection />
      <AboutUsSection
        id="about-us"
        title="We Bring your smile to life"
        body={[
          'At Denel Dental Clinic, we combine compassionate care with modern dentistry to help you achieve a healthy, confident smile. Our experienced team tailors treatments to your needs in a comfortable environment using the latest technology.',
          'From routine checkups to cosmetic and restorative solutions, we focus on prevention, education, and long‑term oral health for the whole family.',
        ]}
        buttonText="Learn More"
        buttonVariant="default"
        buttonClassName="text-base bg-[#B8873A] hover:bg-[#B8873A]/90"
        onButtonClick={() => {}}
        imageSrc="/about01.webp"
        imageAlt="Denel Dental Clinic team and facility"
        imageObjectPosition="center 10%"
        imagePriority={true}
        reverse={false}
      />
      <StatisticsSection />
      <ServicesSection />
      <WhyChooseUsSection />
      <TeamSection />
      <CTASection />
      <FAQSection />
      <TestimonialsSection />
      <Footer />
    </div>
  )
}
