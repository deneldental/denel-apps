'use client'

import { Check, Rocket } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ServiceCategory {
  label: string
  title: string
  description: string
  services: string[]
  href: string
  featured?: boolean
}

const serviceCategories: ServiceCategory[] = [
  {
    label: 'Dental Services',
    title: 'Dental Services',
    description:
      'Comprehensive dental care including consultations, treatments, and preventive care.',
    services: [
      'Dental Consultation',
      'Root Canal Treatment',
      'Teeth Whitening',
      'Orthodontics (Braces & Clear Aligners)',
      'Tooth Replacements',
      'Dental Cleaning',
      'Tooth Filing',
      'Dental Implants',
      'Tooth Extraction',
    ],
    href: '/services/dental-services',
    featured: true,
  },
  {
    label: 'Dental Laboratory',
    title: 'Dental Laboratory',
    description: 'Professional dental laboratory services for dentures, crowns, and repairs.',
    services: ['Acrylic Dentures', 'Valplasts', 'Denture Repair', 'Acrylic crowns'],
    href: '/services/dental-laboratory',
  },
  {
    label: 'Digital Xrays',
    title: 'Digital Dental Xrays',
    description: 'Advanced digital imaging services for accurate diagnosis and treatment planning.',
    services: ['Periapical xrays', 'OPG - xrays', 'Occlusal xrays', 'PA & Lateral Ceph'],
    href: '/services/digital-xrays',
  },
]

export default function Services10Section() {
  return (
    <section id="services10" className="bg-white px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <Badge className="mb-3" variant="secondary">
            Services
          </Badge>
          <h2 className="mb-3 text-4xl font-bold tracking-tight text-gray-900">
            Comprehensive dental care for every smile
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            Comprehensive dental services, laboratory work, and digital imaging—all in one place.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-3">
          {serviceCategories.map((category) => (
            <Card
              key={category.title}
              className={category.featured ? 'border-[#B8873A] ring-2 ring-[#B8873A]/20' : ''}
            >
              <CardHeader>
                <div className="mb-2 flex items-center gap-2">
                  {category.featured ? (
                    <Badge className="bg-[#B8873A] text-black">Featured</Badge>
                  ) : (
                    <Badge variant="outline">{category.label}</Badge>
                  )}
                </div>
                <CardTitle className="text-2xl">{category.title}</CardTitle>
                <CardDescription>{category.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="mb-6 space-y-2 text-sm text-gray-700">
                  {category.services.map((service) => (
                    <li key={service} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 text-green-600 flex-shrink-0" />
                      <span>{service}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    asChild
                    className={
                      category.featured ? 'bg-[#B8873A] text-black hover:bg-[#9C7231]' : ''
                    }
                  >
                    <Link href={category.href}>
                      <Rocket className="mr-2 h-4 w-4" /> Learn More
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
