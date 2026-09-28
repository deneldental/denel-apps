'use client'

import { Menu } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

const navigationMenuItems = [
  { title: 'Home', href: '/' },
  { title: 'About Us', href: '/about-us' },
  { title: 'Services', href: '/services' },
  { title: 'Blog', href: '/blog' },
  { title: 'Contact', href: '/contact' },
]

export default function NavigationMenuDemo() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

  const handleNavClick = () => {
    setIsOpen(false)
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        {/* Logo/Brand */}
        <div className="flex items-center">
          <Link href="/" className="inline-flex items-center">
            <Image
              src="/logo.png"
              alt="Denel Dental Clinic"
              width={70}
              height={10}
              style={{ width: '70px', height: 'auto' }}
              priority
            />
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden items-center gap-1 md:flex">
          {navigationMenuItems.map((item) => (
            <Link key={item.title} href={item.href}>
              <Button
                variant="ghost"
                className={`text-sm font-medium text-[#24296A] ${
                  pathname === item.href
                    ? 'text-[#24296A] bg-[#F6EFE1]'
                    : 'text-gray-700 hover:text-[#24296A] hover:bg-[#F6EFE1]'
                }`}
              >
                {item.title}
              </Button>
            </Link>
          ))}
          <Link href="/appointments">
            <Button className="ml-2 bg-[#B8873A] text-black hover:bg-[#9C7231]">
              Book Appointment
            </Button>
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" aria-expanded={isOpen} aria-controls="mobile-nav">
              <Menu className="h-6 w-6" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[300px] sm:w-[400px]">
            <SheetTitle className="sr-only">Main navigation</SheetTitle>
            <div className="flex flex-col gap-4">
              <div className="m-4">
                <Image src="/logo.png" alt="Denel Dental Clinic" width={60} height={10} priority />
              </div>
              {navigationMenuItems.map((item) => (
                <Link key={item.title} href={item.href} onClick={handleNavClick}>
                  <Button
                    variant="ghost"
                    className={`w-full justify-start text-left text-base font-medium ${
                      pathname === item.href
                        ? 'text-gray-900 bg-[#F6EFE1]'
                        : 'text-gray-700 hover:text-[#B8873A] hover:bg-[#F6EFE1]'
                    }`}
                  >
                    {item.title}
                  </Button>
                </Link>
              ))}
              <Link href="/contact" onClick={handleNavClick}>
                <Button className="mt-4 w-full bg-[#B8873A] text-black hover:bg-[#9C7231]">
                  Book Appointment
                </Button>
              </Link>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  )
}
