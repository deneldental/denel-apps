'use client'

import Image from 'next/image'
import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'

export default function BlogPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Our Blog"
        description="Stay informed with the latest dental health tips, news, and insights from our expert team"
        backgroundImage="/bg02.jpg"
      />
      <section className="relative bg-white px-4 py-20 min-h-[60vh] flex items-center justify-center">
        <div className="container mx-auto max-w-4xl">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl">
            {/* Blurred Background Image */}
            <div className="relative h-[500px] w-full">
              <Image
                src="/bg01.jpg"
                alt="Coming Soon"
                fill
                className="object-cover blur-md scale-110"
                sizes="100vw"
              />
              {/* Overlay */}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="text-center px-6">
                  <h2 className="text-5xl md:text-6xl font-bold text-white mb-4">Coming Soon</h2>
                  <p className="text-xl md:text-2xl text-gray-200 max-w-2xl">
                    We're working on something amazing. Check back soon for the latest dental health
                    tips, news, and insights!
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  )
}
