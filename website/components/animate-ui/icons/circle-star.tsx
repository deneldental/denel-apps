'use client'

import { motion, type Variants } from 'motion/react'

import {
  getVariants,
  type IconProps,
  IconWrapper,
  useAnimateIconContext,
} from '@/components/animate-ui/icons/icon'

type CircleStarProps = IconProps<keyof typeof animations>

const animations = {
  default: {
    circle: {
      initial: { scale: 1, rotate: 0 },
      animate: {
        scale: [1, 1.05, 1],
        rotate: [0, 5, -5, 0],
        transition: { duration: 1.2, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1 },
      },
    },
    star: {
      initial: { scale: 1, rotate: 0 },
      animate: {
        scale: [1, 1.2, 1],
        rotate: [0, 180, 360],
        transition: { duration: 1.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1 },
      },
    },
  } satisfies Record<string, Variants>,
  appear: {
    circle: {
      initial: { opacity: 0, scale: 0.8 },
      animate: {
        opacity: 1,
        scale: 1,
        transition: { type: 'spring', stiffness: 200, damping: 15 },
      },
    },
    star: {
      initial: { opacity: 0, scale: 0, rotate: -90 },
      animate: {
        opacity: 1,
        scale: 1,
        rotate: 0,
        transition: { type: 'spring', stiffness: 200, damping: 15, delay: 0.2 },
      },
    },
  } satisfies Record<string, Variants>,
} as const

function IconComponent({ size, ...props }: CircleStarProps) {
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
      <motion.circle
        cx={12}
        cy={12}
        r={10}
        variants={variants.circle}
        initial="initial"
        animate={controls}
      />
      <g transform="translate(12, 12) scale(0.6) translate(-12, -12)">
        <motion.path
          d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2z"
          variants={variants.star}
          initial="initial"
          animate={controls}
        />
      </g>
    </motion.svg>
  )
}

function CircleStar(props: CircleStarProps) {
  return <IconWrapper icon={IconComponent} {...props} />
}

export {
  animations,
  CircleStar,
  CircleStar as CircleStarIcon,
  type CircleStarProps,
  type CircleStarProps as CircleStarIconProps,
}
