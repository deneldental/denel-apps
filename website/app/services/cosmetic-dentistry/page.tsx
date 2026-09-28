'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'

export default function CosmeticDentistryPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Cosmetic Dentistry"
        description="Whitening, veneers, and minimally invasive treatments for a confident smile."
        backgroundImage="/bg03.jpg"
      />
      <div className="container mx-auto max-w-6xl px-4 py-12">
        <p className="text-gray-700">
          This is a placeholder page for Cosmetic Dentistry. Add procedures, before/after, and CTA
          here.
        </p>
      </div>
      <Footer />
    </div>
  )
}
