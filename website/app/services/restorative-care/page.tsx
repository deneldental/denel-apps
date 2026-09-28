'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'

export default function RestorativeCarePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Restorative Care"
        description="Durable solutions to repair, protect, and restore your teeth."
        backgroundImage="/bg04.jpg"
      />
      <div className="container mx-auto max-w-6xl px-4 py-12">
        <p className="text-gray-700">
          This is a placeholder page for Restorative Care. Add treatments, timelines, and CTA here.
        </p>
      </div>
      <Footer />
    </div>
  )
}
