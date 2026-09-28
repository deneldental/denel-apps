'use client'

import { motion, type Variants } from 'motion/react'

import {
  getVariants,
  type IconProps,
  IconWrapper,
  useAnimateIconContext,
} from '@/components/animate-ui/icons/icon'

type ShieldCheckProps = IconProps<keyof typeof animations>

const animations = {
  default: {
    shield: {
      initial: { y: 0 },
      animate: {
        y: [0, 2, -2, 0],
        transition: { duration: 0.6, ease: 'easeInOut' },
      },
    },
    check: {
      initial: { pathLength: 0, scale: 0.8, opacity: 0 },
      animate: {
        pathLength: [0, 1, 1],
        scale: [0.8, 1.2, 1],
        opacity: [0, 1, 1],
        transition: {
          duration: 0.8,
          ease: 'easeInOut',
          delay: 0.2,
          times: [0, 0.6, 1],
        },
      },
    },
  } satisfies Record<string, Variants>,
  appear: {
    shield: {
      initial: { opacity: 0, y: 4 },
      animate: {
        opacity: 1,
        y: 0,
        transition: { type: 'spring', stiffness: 120, damping: 12 },
      },
    },
    check: {
      initial: { pathLength: 0, scale: 0, opacity: 0 },
      animate: {
        pathLength: 1,
        scale: 1,
        opacity: 1,
        transition: {
          type: 'spring',
          stiffness: 200,
          damping: 15,
          delay: 0.3,
        },
      },
    },
  } satisfies Record<string, Variants>,
} as const

function IconComponent({ size, ...props }: ShieldCheckProps) {
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
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"
        variants={variants.shield}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="m9 12 2 2 4-4"
        variants={variants.check}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  )
}

function ShieldCheck(props: ShieldCheckProps) {
  return <IconWrapper icon={IconComponent} {...props} />
}

export {
  animations,
  ShieldCheck,
  ShieldCheck as ShieldCheckIcon,
  type ShieldCheckProps,
  type ShieldCheckProps as ShieldCheckIconProps,
}
