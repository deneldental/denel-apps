'use client'

import Image from 'next/image'
import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'

type ButtonVariant = ComponentProps<typeof Button>['variant']

type AboutUsSectionProps = {
  id?: string
  title?: string
  body?: string[]
  buttonText?: string
  buttonVariant?: ButtonVariant
  buttonClassName?: string
  onButtonClick?: () => void
  imageSrc?: string
  imageAlt?: string
  imageObjectPosition?: string
  imagePriority?: boolean
  reverse?: boolean
}

export default function AboutUsSection({
  id = 'about-us',
  title = 'We Bring your smile to life',
  body = [
    'At Denel Dental Clinic, we combine compassionate care with modern dentistry to help you achieve a healthy, confident smile. Our experienced team tailors treatments to your needs in a comfortable environment using the latest technology.',
    'From routine checkups to cosmetic and restorative solutions, we focus on prevention, education, and long‑term oral health for the whole family.',
  ],
  buttonText = 'Learn More',
  buttonVariant = 'default',
  buttonClassName = 'text-base bg-[#B8873A] hover:bg-[#B8873A]/90',
  onButtonClick,
  imageSrc = '/about01.webp',
  imageAlt = 'Denel Dental Clinic team and facility',
  imageObjectPosition = 'center 10%',
  imagePriority = true,
  reverse = false,
}: AboutUsSectionProps) {
  return (
    <section id={id} className="bg-white px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className={reverse ? 'order-2 lg:order-2' : 'order-2 lg:order-1'}>
            <h2 className="mb-4 text-4xl font-bold text-gray-900">{title}</h2>
            {body &&
              body.length > 0 &&
              body.map((paragraph, index) => (
                <p
                  key={index}
                  className={`text-lg text-gray-600 ${index === body.length - 1 ? 'mb-8' : 'mb-4'}`}
                >
                  {paragraph}
                </p>
              ))}
            <div className="flex flex-col gap-3 sm:flex-row">
              {buttonText && (
                <Button
                  size="lg"
                  variant={buttonVariant}
                  className={buttonClassName}
                  onClick={onButtonClick}
                >
                  {buttonText}
                </Button>
              )}
            </div>
          </div>
          <div className={reverse ? 'order-1 lg:order-1' : 'order-1 lg:order-2'}>
            <div className="relative h-96 sm:h-128 overflow-hidden rounded-2xl shadow-lg">
              <Image
                src={imageSrc}
                alt={imageAlt}
                fill
                className="object-cover"
                style={{ objectPosition: imageObjectPosition }}
                sizes="(min-width: 1024px) 48vw, 100vw"
                priority={imagePriority}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
