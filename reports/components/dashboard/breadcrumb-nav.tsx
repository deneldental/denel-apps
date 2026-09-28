import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

export function BreadcrumbNav() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)

  // segments example: ['revenues', '2025', 'january', '1']

  const generateCrumbs = () => {
    const crumbs = []
    let currentPath = ''

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      currentPath += `/${segment}`

      // Format label: capitalize
      let label = segment.charAt(0).toUpperCase() + segment.slice(1)

      // Special handling if numeric (Week) logic could go here
      // If it's a number and the previous segment was a month (simplified check)
      if (!Number.isNaN(Number(segment)) && i === 3) {
        label = `Week ${segment}`
      }

      crumbs.push({
        href: currentPath,
        label: label,
        isLast: i === segments.length - 1,
      })
    }
    return crumbs
  }

  const crumbs = generateCrumbs()

  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        {crumbs.map((crumb) => (
          <React.Fragment key={crumb.href}>
            <BreadcrumbItem>
              {crumb.isLast ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {!crumb.isLast && <BreadcrumbSeparator />}
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
