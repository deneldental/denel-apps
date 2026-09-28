'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'

export default function GeneralDentistryPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="General Dentistry"
        description="Routine checkups, cleanings, and preventive care for lasting oral health."
        backgroundImage="/bg01.jpg"
      />
      <div className="container mx-auto max-w-6xl px-4 py-12">
        <p className="text-gray-700">
          This is a placeholder page for General Dentistry. Add detailed content, FAQs, and CTA
          here.
        </p>
      </div>
      <Footer />
    </div>
  )
}
