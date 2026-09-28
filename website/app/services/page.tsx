'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'
import CTASection from '@/components/sections/cta-section'
import Services10Section from '@/components/sections/services10-section'

export default function ServicesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Our Services"
        description="Comprehensive dental care tailored to your needs and goals"
        backgroundImage="/bg03.jpg"
      />
      <Services10Section />
      <CTASection />
      <Footer />
    </div>
  )
}
