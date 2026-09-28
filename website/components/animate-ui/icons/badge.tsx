'use client'

import { motion, type Variants } from 'motion/react'

import {
  getVariants,
  type IconProps,
  IconWrapper,
  useAnimateIconContext,
} from '@/components/animate-ui/icons/icon'

type BadgeProps = IconProps<keyof typeof animations>

const animations = {
  default: {
    badge: {
      initial: { y: 0, scale: 1 },
      animate: {
        y: [0, -3, 3, 0],
        scale: [1, 1.05, 1],
        transition: { duration: 0.8, ease: 'easeInOut', repeat: Infinity, repeatDelay: 2 },
      },
    },
    star: {
      initial: { rotate: 0, scale: 1 },
      animate: {
        rotate: [0, 10, -10, 0],
        scale: [1, 1.1, 1],
        transition: { duration: 0.6, ease: 'easeInOut', delay: 0.1 },
      },
    },
  } satisfies Record<string, Variants>,
  appear: {
    badge: {
      initial: { opacity: 0, scale: 0.8, y: 10 },
      animate: {
        opacity: 1,
        scale: 1,
        y: 0,
        transition: { type: 'spring', stiffness: 200, damping: 15 },
      },
    },
    star: {
      initial: { opacity: 0, rotate: -45, scale: 0 },
      animate: {
        opacity: 1,
        rotate: 0,
        scale: 1,
        transition: { type: 'spring', stiffness: 200, damping: 15, delay: 0.2 },
      },
    },
  } satisfies Record<string, Variants>,
} as const

function IconComponent({ size, ...props }: BadgeProps) {
  const { controls } = useAnimateIconContext()
  const variants = getVariants(animations)

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.path
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
        variants={variants.badge}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="m9 12 2 2 4-4"
        variants={variants.star}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  )
}

function Badge(props: BadgeProps) {
  return <IconWrapper icon={IconComponent} {...props} />
}

export { animations, Badge, Badge as BadgeIcon, type BadgeProps, type BadgeProps as BadgeIconProps }
