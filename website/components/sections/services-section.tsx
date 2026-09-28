'use client'

import { ArrowLeft, ArrowRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Carousel, type CarouselApi, CarouselContent, CarouselItem } from '@/components/ui/carousel'

const services = [
  {
    image: '/bg01.jpg',
    title: 'Dental Services',
    desc: 'Comprehensive dental care including consultations, root canals, whitening, orthodontics, implants, and more.',
  },
  {
    image: '/bg03.jpg',
    title: 'Dental Laboratory',
    desc: 'Professional laboratory services for acrylic dentures, Valplasts, repairs, and crowns.',
  },
  {
    image: '/bg02.jpg',
    title: 'Digital Dental Xrays',
    desc: 'Advanced digital imaging including periapical, OPG, occlusal xrays, and PA & Lateral Ceph.',
  },
] as const

export default function ServicesSection() {
  const [servicesApi, setServicesApi] = useState<CarouselApi | undefined>(undefined)

  useEffect(() => {
    if (!servicesApi) return
    const id = setInterval(() => {
      servicesApi.scrollNext()
    }, 5000)
    return () => clearInterval(id)
  }, [servicesApi])

  return (
    <section id="services" className="bg-white px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-4xl font-bold text-gray-900">Our Services</h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            Comprehensive dental services, laboratory work, and digital imaging—all in one place
          </p>
        </div>

        <Carousel
          opts={{ align: 'start', loop: true }}
          className="w-full h-full"
          setApi={setServicesApi}
        >
          <CarouselContent>
            {services.map((s, i) => (
              <CarouselItem key={i} className="basis-full sm:basis-1/2 lg:basis-1/3">
                <Card className="overflow-hidden p-0">
                  <div className="relative w-full aspect-[16/9]">
                    <Image
                      src={s.image}
                      alt={s.title}
                      fill
                      className="object-cover object-center"
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    />
                  </div>
                  <CardHeader>
                    <CardTitle>{s.title}</CardTitle>
                    <CardDescription>{s.desc}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Link href="/services">
                      <Button variant="outline" size="sm" className="w-full mb-4">
                        Read More <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        <div className="mt-6 flex w-full items-center justify-center gap-3">
          <Button
            variant="outline"
            className="flex items-center"
            onClick={() => servicesApi?.scrollPrev()}
          >
            <ArrowLeft className="mr-2 h-5 w-5" /> Prev
          </Button>
          <Button
            variant="outline"
            className="flex items-center"
            onClick={() => servicesApi?.scrollNext()}
          >
            Next <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>

        <Button
          size="lg"
          variant="outline"
          className="text-base mt-10 mx-auto flex items-center justify-center w-fit hover:bg-[#B8873A] hover:text-black"
        >
          <ArrowRight className="mr-2 h-5 w-5" />
          View All Services
        </Button>
      </div>
    </section>
  )
}
