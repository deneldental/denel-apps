'use client'

import Image from 'next/image'
import Link from 'next/link'
import {
  FaFacebook,
  FaInstagram,
  FaLinkedin,
  FaSnapchat,
  FaTiktok,
  FaYoutube,
} from 'react-icons/fa'

export default function Footer() {
  return (
    <footer className="bg-[#24296A] text-gray-300">
      <div className="container mx-auto max-w-6xl px-8 py-12">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
          {/* Brand Section */}
          <div className="lg:col-span-2">
            <Link href="/" className="inline-block mb-4">
              <div className="flex items-center gap-2">
                <Image
                  src="/logo-white.png"
                  alt="Denel Dental"
                  width={100}
                  height={40}
                  style={{ width: '100px', height: 'auto' }}
                  className="rounded"
                />
              </div>
            </Link>
            <p className="mb-6 max-w-sm text-sm text-white">
              Professional dental care for you and your family. <br /> Making your dream smile a
              reality.
            </p>
          </div>

          {/* Social Links */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-white">Follow Us</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm hover:text-white transition-colors flex items-center gap-2"
                >
                  <FaFacebook className="h-4 w-4" />
                  Facebook
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm hover:text-white transition-colors flex items-center gap-2"
                >
                  <FaTiktok className="h-4 w-4" />
                  TikTok
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm hover:text-white transition-colors flex items-center gap-2"
                >
                  <FaInstagram className="h-4 w-4" />
                  Instagram
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm hover:text-white transition-colors flex items-center gap-2"
                >
                  <FaSnapchat className="h-4 w-4" />
                  Snapchat
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm hover:text-white transition-colors flex items-center gap-2"
                >
                  <FaYoutube className="h-4 w-4" />
                  YouTube
                </Link>
              </li>
              <li>
                <Link
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm hover:text-white transition-colors flex items-center gap-2"
                >
                  <FaLinkedin className="h-4 w-4" />
                  LinkedIn
                </Link>
              </li>
            </ul>
          </div>

          {/* Support Links */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-white">Support</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/faq" className="text-sm hover:text-white transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/scan" className="text-sm hover:text-white transition-colors">
                  Scan
                </Link>
              </li>
              <li>
                <Link href="/appointments" className="text-sm hover:text-white transition-colors">
                  Book Appointment
                </Link>
              </li>
              <li>
                <Link href="/privacy-policy" className="text-sm hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms-of-service"
                  className="text-sm hover:text-white transition-colors"
                >
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h3 className="mb-4 text-sm font-semibold text-white">Company</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/about-us" className="text-sm hover:text-white transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/services" className="text-sm hover:text-white transition-colors">
                  Services
                </Link>
              </li>
              <li>
                <Link href="/blog" className="text-sm hover:text-white transition-colors">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-sm hover:text-white transition-colors">
                  Contact Us
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Social Media & Copyright */}
        <div className="mt-12 border-t border-[#B8873A] pt-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="text-sm text-gray-200">
              © {new Date().getFullYear()} Denel Dental Clinic. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
