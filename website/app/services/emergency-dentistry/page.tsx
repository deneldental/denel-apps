'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'

export default function EmergencyDentistryPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Emergency Dentistry"
        description="Same‑day relief for pain, broken teeth, and urgent dental needs."
        backgroundImage="/bg06.jpg"
      />
      <div className="container mx-auto max-w-6xl px-4 py-12">
        <p className="text-gray-700">
          This is a placeholder page for Emergency Dentistry. Add triage steps, availability, and
          CTA here.
        </p>
      </div>
      <Footer />
    </div>
  )
}
