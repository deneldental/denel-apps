'use client'

import { ExternalLink, Heart, Star } from 'lucide-react'
import Link from 'next/link'
import {
  FaFacebook,
  FaInstagram,
  FaLinkedin,
  FaSnapchat,
  FaTiktok,
  FaYoutube,
} from 'react-icons/fa'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ScanPage() {
  const socialLinks = [
    {
      name: 'Facebook',
      icon: FaFacebook,
      url: '#',
      color: 'hover:bg-blue-600',
      bgColor: 'bg-blue-500',
    },
    {
      name: 'TikTok',
      icon: FaTiktok,
      url: '#',
      color: 'hover:bg-black',
      bgColor: 'bg-gray-900',
    },
    {
      name: 'Instagram',
      icon: FaInstagram,
      url: '#',
      color: 'hover:bg-pink-600',
      bgColor: 'bg-gradient-to-br from-purple-600 via-pink-600 to-orange-500',
    },
    {
      name: 'Snapchat',
      icon: FaSnapchat,
      url: '#',
      color: 'hover:bg-yellow-400',
      bgColor: 'bg-yellow-300',
    },
    {
      name: 'YouTube',
      icon: FaYoutube,
      url: '#',
      color: 'hover:bg-red-600',
      bgColor: 'bg-red-500',
    },
    {
      name: 'LinkedIn',
      icon: FaLinkedin,
      url: '#',
      color: 'hover:bg-blue-700',
      bgColor: 'bg-blue-600',
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-[#F7F2E9] to-white">
      <div className="container mx-auto max-w-6xl px-4 py-16">
        {/* Header Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-4">
            <Heart className="h-8 w-8 text-[#B8873A] fill-[#B8873A]" />
            <h1 className="text-4xl md:text-5xl font-bold text-[#24296A]">
              Thank You for Visiting!
            </h1>
            <Heart className="h-8 w-8 text-[#B8873A] fill-[#B8873A]" />
          </div>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            We'd love to hear about your experience and stay connected with you
          </p>
        </div>

        {/* Google Review Section */}
        <Card className="mb-12 border-2 border-[#B8873A] shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-[#24296A] to-[#1B1F52] text-white p-8">
            <CardHeader className="p-0 mb-6">
              <div className="flex items-center justify-center gap-3 mb-2">
                <Star className="h-8 w-8 fill-[#B8873A] text-[#B8873A]" />
                <CardTitle className="text-3xl font-bold">Leave a Google Review</CardTitle>
                <Star className="h-8 w-8 fill-[#B8873A] text-[#B8873A]" />
              </div>
              <CardDescription className="text-gray-200 text-center text-lg">
                Your feedback helps us serve you better and helps others find quality dental care
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-col items-center gap-4">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className="h-10 w-10 fill-[#B8873A] text-[#B8873A] animate-pulse"
                      style={{ animationDelay: `${star * 0.1}s` }}
                    />
                  ))}
                </div>
                <Link
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full max-w-md"
                >
                  <Button
                    size="lg"
                    className="w-full bg-[#B8873A] hover:bg-[#A67C33] text-white font-semibold text-lg py-6 rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 hover:scale-105"
                  >
                    <ExternalLink className="mr-2 h-5 w-5" />
                    Write a Google Review
                  </Button>
                </Link>
                <p className="text-sm text-gray-300 text-center max-w-md">
                  Click the button above to share your experience on Google. It only takes a minute!
                </p>
              </div>
            </CardContent>
          </div>
        </Card>

        {/* Social Media Section */}
        <Card className="mb-12 shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold text-[#24296A] mb-2">
              Connect With Us
            </CardTitle>
            <CardDescription className="text-lg">
              Follow us on social media for dental tips, updates, and special offers
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {socialLinks.map((social) => {
                const Icon = social.icon
                return (
                  <Link
                    key={social.name}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group"
                  >
                    <div className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-gray-200 hover:border-[#B8873A] transition-all duration-300 hover:shadow-lg hover:scale-105">
                      <div
                        className={`${social.bgColor} p-4 rounded-full text-white transition-transform duration-300 group-hover:rotate-12`}
                      >
                        <Icon className="h-8 w-8" />
                      </div>
                      <span className="font-semibold text-gray-700 group-hover:text-[#24296A]">
                        {social.name}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* YouTube Playlist Section */}
        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold text-[#24296A] mb-2">
              Watch Our Videos
            </CardTitle>
            <CardDescription className="text-lg">
              Learn about dental health, procedures, and patient testimonials
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="aspect-video w-full rounded-xl overflow-hidden shadow-xl">
              <div className="flex h-full w-full items-center justify-center bg-gray-50 text-gray-500">
                Our videos will be available here soon.
              </div>
            </div>
            <div className="mt-6 text-center">
              <Link href="#" target="_blank" rel="noopener noreferrer">
                <Button
                  variant="outline"
                  size="lg"
                  className="border-2 border-[#B8873A] text-[#24296A] hover:bg-[#B8873A] hover:text-white font-semibold"
                >
                  <FaYoutube className="mr-2 h-5 w-5" />
                  Visit Our YouTube Channel
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Call to Action */}
        <div className="mt-12 text-center">
          <p className="text-gray-600 mb-4">Need to book an appointment or have questions?</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/appointments">
              <Button
                size="lg"
                className="bg-[#24296A] hover:bg-[#1B1F52] text-white font-semibold px-8"
              >
                Book Appointment
              </Button>
            </Link>
            <Link href="/contact">
              <Button
                size="lg"
                variant="outline"
                className="border-2 border-[#24296A] text-[#24296A] hover:bg-[#24296A] hover:text-white font-semibold px-8"
              >
                Contact Us
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
