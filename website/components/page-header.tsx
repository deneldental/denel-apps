'use client'

import { motion } from 'motion/react'
import Image from 'next/image'

interface PageHeaderProps {
  title: string
  description?: string
  backgroundImage?: string
}

export default function PageHeader({ title, description, backgroundImage }: PageHeaderProps) {
  return (
    <section className="relative bg-gradient-to-r from-[#B8873A] to-[#B8873A] px-4 py-20 text-[#24296A]">
      {backgroundImage && (
        <div className="absolute inset-0">
          <Image
            src={backgroundImage}
            alt={title}
            fill
            className="object-cover object-center"
            sizes="100vw"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white/80 via-white/80 to-[rgba(184,135,58,0.8)]" />
        </div>
      )}
      <div className="container relative z-10 mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center"
        >
          <h1 className="mb-4 text-4xl font-bold sm:text-5xl md:text-6xl">{title}</h1>
          {description && (
            <p className="mx-auto max-w-2xl text-lg text-[#24296A] sm:text-xl">{description}</p>
          )}
        </motion.div>
      </div>
    </section>
  )
}
