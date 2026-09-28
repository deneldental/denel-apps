'use client'

import { useRouter } from 'next/navigation'
import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'
import AboutUsSection from '@/components/sections/about-us-section'
import About1Section from '@/components/sections/about1-section'
import CTASection from '@/components/sections/cta-section'
import OurStorySection from '@/components/sections/our-story-section'
import TeamGridSection from '@/components/sections/team-grid-section'
import TestimonialsSection from '@/components/sections/testimonials-section'
import WhyChooseUsSection from '@/components/sections/why-choose-us-section'

export default function AboutUsPage() {
  const router = useRouter()
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="About Us"
        description="Learn more about our practice, our mission, and our commitment to providing exceptional dental care"
        backgroundImage="/bg01.jpg"
      />
      <OurStorySection />
      <About1Section />
      <AboutUsSection
        imageSrc="/about2.jpg"
        imageAlt="Denel Dental Clinic team and facility"
        title="Making your Dream Smile"
        body={[
          'We are a team of dedicated professionals who are passionate about helping you achieve your dream smile. We use the latest technology and techniques to help you achieve your dream smile.',
        ]}
        buttonText="Book an Appointment"
        onButtonClick={() => {
          router.push('/appointments')
        }}
      />
      <WhyChooseUsSection />
      <CTASection />
      <TeamGridSection />
      <TestimonialsSection />
      <Footer />
    </div>
  )
}
