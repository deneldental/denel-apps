'use client'

import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'

export default function OrthodonticsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Orthodontics"
        description="Straighter teeth and a balanced bite with clear aligners or braces."
        backgroundImage="/bg08.jpg"
      />
      <div className="container mx-auto max-w-6xl px-4 py-12">
        <p className="text-gray-700">
          This is a placeholder page for Orthodontics. Add aligner details, timelines, and CTA here.
        </p>
      </div>
      <Footer />
    </div>
  )
}
