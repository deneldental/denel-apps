'use client'

import Link from 'next/link'
import Footer from '@/components/footer'
import NavigationMenuDemo from '@/components/navigation-menu'
import PageHeader from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const services = [
  {
    title: 'Periapical Xrays',
    description:
      'Detailed images of individual teeth from crown to root. Periapical xrays help diagnose issues such as abscesses, root fractures, and bone loss around specific teeth, providing essential information for treatment planning.',
  },
  {
    title: 'OPG - Xrays',
    description:
      'Orthopantomogram (OPG) provides a panoramic view of your entire mouth, including all teeth, jaws, and surrounding structures. This comprehensive imaging is essential for overall oral health assessment, wisdom tooth evaluation, and treatment planning.',
  },
  {
    title: 'Occlusal Xrays',
    description:
      "Large-scale images showing the roof or floor of the mouth and the relationship between upper and lower teeth. Occlusal xrays are particularly useful for detecting extra teeth, jaw fractures, and evaluating the development of children's teeth.",
  },
  {
    title: 'PA & Lateral Ceph',
    description:
      'Posteroanterior (PA) and Lateral Cephalometric xrays provide detailed views of the skull and jaw structure. These images are essential for orthodontic treatment planning, evaluating jaw relationships, and assessing facial growth patterns.',
  },
]

export default function DigitalXraysPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavigationMenuDemo />
      <PageHeader
        title="Digital Dental Xrays"
        description="Advanced digital imaging services for accurate diagnosis and treatment planning"
        backgroundImage="/bg02.jpg"
      />
      <section className="bg-white px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-12">
            <p className="mx-auto max-w-3xl text-lg text-gray-600 text-center">
              Our digital xray services use the latest imaging technology to provide clear, detailed
              images with minimal radiation exposure. Digital xrays offer immediate results,
              enhanced diagnostic capabilities, and are essential for accurate treatment planning
              and monitoring.
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
