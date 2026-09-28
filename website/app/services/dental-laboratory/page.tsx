'use client'

import Link from 'next/link'
import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const services = [
  {
    title: 'Acrylic Dentures',
    description:
      'High-quality acrylic dentures custom-made to fit your mouth perfectly. Our laboratory creates durable, comfortable, and natural-looking dentures that restore your ability to eat, speak, and smile with confidence.',
  },
  {
    title: 'Valplasts',
    description:
      'Flexible partial dentures made from a unique thermoplastic material. Valplast dentures are lightweight, comfortable, and virtually invisible, providing a natural appearance without metal clasps.',
  },
  {
    title: 'Denture Repair',
    description:
      'Expert repair services for damaged or broken dentures. We provide quick and reliable repairs to restore your dentures to their original function and appearance, often completed the same day.',
  },
  {
    title: 'Acrylic Crowns',
    description:
      'Custom-fabricated acrylic crowns for temporary or permanent use. Our laboratory creates precise-fitting crowns that match your natural teeth in color and shape, providing excellent aesthetics and function.',
  },
]

export default function DentalLaboratoryPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Dental Laboratory"
        description="Professional dental laboratory services for dentures, crowns, and repairs"
        backgroundImage="/bg03.jpg"
      />
      <section className="bg-white px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-12">
            <p className="mx-auto max-w-3xl text-lg text-gray-600 text-center">
              Our state-of-the-art dental laboratory provides high-quality prosthetic and
              restorative services. We work closely with dentists to create custom dental appliances
              that meet the highest standards of precision, aesthetics, and durability.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {services.map((service, index) => (
              <Card key={index} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="text-xl text-[#B8873A]">{service.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base text-gray-700 leading-relaxed">
                    {service.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Button size="lg" className="bg-[#B8873A] hover:bg-[#B8873A]/90 text-black" asChild>
              <Link href="/appointments">Book an Appointment</Link>
            </Button>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  )
}
