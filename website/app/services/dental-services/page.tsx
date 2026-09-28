'use client'

import Link from 'next/link'
import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const services = [
  {
    title: 'Dental Consultation',
    description:
      'Comprehensive oral health assessment and personalized treatment planning. Our experienced dentists evaluate your dental health, discuss your concerns, and create a customized care plan tailored to your needs.',
  },
  {
    title: 'Root Canal Treatment',
    description:
      'Advanced endodontic therapy to save infected or damaged teeth. We use modern techniques and technology to ensure comfortable treatment while preserving your natural tooth structure.',
  },
  {
    title: 'Teeth Whitening',
    description:
      'Professional teeth whitening services to brighten your smile. We offer both in-office and take-home whitening options using safe, effective, and FDA-approved products.',
  },
  {
    title: 'Orthodontics (Braces & Clear Aligners)',
    description:
      "Comprehensive orthodontic solutions including traditional braces and clear aligners like Invisalign. We help straighten teeth, correct bite issues, and improve your smile's appearance and function.",
  },
  {
    title: 'Tooth Replacements',
    description:
      'Restore missing teeth with durable and natural-looking replacement options. We offer bridges, partial dentures, and full dentures to restore your smile and oral function.',
  },
  {
    title: 'Dental Cleaning',
    description:
      'Professional dental cleanings to maintain optimal oral health. Our hygienists remove plaque, tartar, and stains while providing preventive care and oral hygiene education.',
  },
  {
    title: 'Tooth Filing',
    description:
      'Restore damaged or decayed teeth with tooth-colored composite fillings. We use modern materials that match your natural tooth color and provide durable, long-lasting results.',
  },
  {
    title: 'Dental Implants',
    description:
      'Permanent tooth replacement solution using titanium implants. Dental implants provide a stable foundation for crowns, bridges, or dentures, restoring both function and aesthetics.',
  },
  {
    title: 'Tooth Extraction',
    description:
      'Safe and gentle tooth removal procedures when a tooth cannot be saved. Our experienced dentists perform extractions with minimal discomfort, using local anesthesia and modern techniques to ensure a smooth recovery process.',
  },
]

export default function DentalServicesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Dental Services"
        description="Comprehensive dental care including consultations, treatments, and preventive care"
        backgroundImage="/bg01.jpg"
      />
      <section className="bg-white px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-12">
            <p className="mx-auto max-w-3xl text-lg text-gray-600 text-center">
              Our dental services cover a wide range of treatments designed to maintain, restore,
              and enhance your oral health. From routine checkups to advanced procedures, we provide
              comprehensive care using the latest technology and techniques.
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
