'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'

export default function FamilyDentistryPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Family Dentistry"
        description="Gentle, age‑appropriate care for kids, teens, and adults."
        backgroundImage="/bg05.jpg"
      />
      <div className="container mx-auto max-w-6xl px-4 py-12">
        <p className="text-gray-700">
          This is a placeholder page for Family Dentistry. Add pediatric info, visits, and CTA here.
        </p>
      </div>
      <Footer />
    </div>
  )
}
