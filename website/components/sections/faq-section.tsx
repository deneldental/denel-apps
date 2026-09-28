'use client'

import NextLink from 'next/link'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'

export default function FAQSection() {
  return (
    <section id="faq" className="bg-gray-50 px-4 py-20">
      <div className="container mx-auto max-w-4xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-4xl font-bold text-gray-900">Frequently Asked Questions</h2>
          <p className="mx-auto max-w-2xl text-lg sm:text-xl text-gray-600">
            Find answers to common questions about our dental services and procedures
          </p>
        </div>
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger className="text-left text-lg sm:text-xl font-medium">
              What services does Denel Dental offer?
            </AccordionTrigger>
            <AccordionContent className="text-base sm:text-lg leading-relaxed text-gray-700">
              We offer a comprehensive range of dental services including general dentistry,
              cosmetic dentistry, restorative care, family dentistry, pediatric dentistry, emergency
              care, and orthodontics. Our experienced team provides everything from routine
              cleanings to advanced treatments.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger className="text-left text-lg sm:text-xl font-medium">
              Do you accept dental insurance?
            </AccordionTrigger>
            <AccordionContent className="text-base sm:text-lg leading-relaxed text-gray-700">
              Yes, we accept most major dental insurance plans. Please contact our office to verify
              your specific insurance coverage and to discuss payment options. We also offer
              flexible payment plans for treatments not covered by insurance.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger className="text-left text-lg sm:text-xl font-medium">
              How often should I visit the dentist?
            </AccordionTrigger>
            <AccordionContent className="text-base sm:text-lg leading-relaxed text-gray-700">
              We recommend visiting the dentist every six months for routine checkups and cleanings.
              However, the frequency may vary based on your individual oral health needs. Your
              dentist will advise you on the best schedule during your visit.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-4">
            <AccordionTrigger className="text-left text-lg sm:text-xl font-medium">
              What should I do in a dental emergency?
            </AccordionTrigger>
            <AccordionContent className="text-base sm:text-lg leading-relaxed text-gray-700">
              If you experience a dental emergency, please call our office immediately. We offer
              same-day emergency appointments for urgent issues such as severe tooth pain,
              knocked-out teeth, or dental trauma. We'll do our best to see you as soon as possible.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-5">
            <AccordionTrigger className="text-left text-lg sm:text-xl font-medium">
              Is teeth whitening safe?
            </AccordionTrigger>
            <AccordionContent className="text-base sm:text-lg leading-relaxed text-gray-700">
              Yes, professional teeth whitening is safe when performed under the supervision of a
              qualified dentist. We use FDA-approved whitening products and customize treatments to
              your specific needs. We'll first examine your teeth to ensure whitening is appropriate
              for you.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-6">
            <AccordionTrigger className="text-left text-lg sm:text-xl font-medium">
              Do you treat children?
            </AccordionTrigger>
            <AccordionContent className="text-base sm:text-lg leading-relaxed text-gray-700">
              Absolutely! We are a family-friendly dental practice that treats patients of all ages,
              including children. Our team is experienced in making dental visits comfortable and
              positive for young patients, helping establish good oral health habits from an early
              age.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-7">
            <AccordionTrigger className="text-left text-lg sm:text-xl font-medium">
              What payment methods do you accept?
            </AccordionTrigger>
            <AccordionContent className="text-base sm:text-lg leading-relaxed text-gray-700">
              We accept cash, credit cards, and debit cards. We also work with most dental insurance
              plans and offer flexible payment options for more extensive treatments. Our team can
              discuss financing options during your consultation.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <div className="mt-12 text-center">
          <p className="mb-4 text-gray-600">Still have questions? We're here to help!</p>
          <Button size="lg" variant="outline" className="text-base" asChild>
            <NextLink href="/faq">More Questions?</NextLink>
          </Button>
        </div>
      </div>
    </section>
  )
}
