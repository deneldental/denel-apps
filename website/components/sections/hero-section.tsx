'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'

const slides = [
  {
    image: '/bg01.jpg',
    title: 'Welcome to Denel Dental',
    subtitle: 'Gentle, modern dentistry for your whole family.',
  },
  {
    image: '/bg02.jpg',
    title: 'Preventive Checkups',
    subtitle: 'Keep your smile healthy with routine cleanings and exams.',
  },
  {
    image: '/bg03.jpg',
    title: 'Cosmetic Dentistry',
    subtitle: 'Whitening and veneers to enhance your natural smile.',
  },
  {
    image: '/bg04.jpg',
    title: 'Restorative Care',
    subtitle: 'Crowns, bridges, and implants for strong, lasting results.',
  },
  {
    image: '/bg05.jpg',
    title: 'Emergency Appointments',
    subtitle: 'Same‑day care for tooth pain and urgent issues.',
  },
  {
    image: '/bg06.jpg',
    title: 'Family Dentistry',
    subtitle: 'Compassionate care tailored for all ages.',
  },
  {
    image: '/bg07.jpg',
    title: 'Orthodontic Options',
    subtitle: 'Straighter teeth with modern, discreet solutions.',
  },
  {
    image: '/bg08.jpg',
    title: 'State‑of‑the‑Art Clinic',
    subtitle: 'Comfortable environment with advanced technology.',
  },
]

export default function HeroSection() {
  const [carouselApi, setCarouselApi] = useState<CarouselApi | undefined>(undefined)

  useEffect(() => {
    if (!carouselApi) return
    const id = setInterval(() => {
      carouselApi.scrollNext()
    }, 10000)
    return () => clearInterval(id)
  }, [carouselApi])

  return (
    <section id="home" className="relative px-0 py-0">
      <div className="relative w-full">
        <Carousel
          opts={{ loop: true, align: 'start' }}
          className="relative w-full"
          setApi={setCarouselApi}
        >
          <CarouselContent>
            {slides.map((slide, idx) => (
              <CarouselItem key={idx}>
                <div className="relative h-[50vh] sm:h-[50vh] w-full">
                  <Image
                    src={slide.image}
                    alt={slide.title}
                    fill
                    className="object-cover object-center"
                    sizes="100vw"
                    priority={idx === 0}
                  />
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/40 to-transparent" />
                  <div className="relative z-10 flex h-full items-end justify-center px-6 pb-10 sm:pb-14">
                    <div className="mx-auto max-w-4xl text-center">
                      <h1 className="mb-2 text-3xl font-bold tracking-tight text-white sm:mb-4 sm:text-5xl">
                        {slide.title}
                      </h1>
                      <p className="mx-auto mb-6 max-w-2xl text-base text-[#F1E6CC] sm:text-xl">
                        {slide.subtitle}
                      </p>
                      {/* <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                        <Button size="lg" variant="default" className="text-base bg-[#B8873A] hover:bg-[#B8873A]/90 hover:text-white">
                          <a href="/appointments" className="text-base flex items-center gap-2">
                          <Calendar className="h-5 w-5" />
                          Book Appointment
                          </a>
                        </Button>
                      </div> */}
                    </div>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious
            className="left-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white"
            aria-label="Previous slide"
          />
          <CarouselNext
            className="right-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white"
            aria-label="Next slide"
          />
        </Carousel>
      </div>
    </section>
  )
}
