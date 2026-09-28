import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/shared/components/ui/breadcrumb'

export function ExpensesBreadcrumb() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)

  // segments: ['expenses', '2025', 'january', '1']

  const generateCrumbs = () => {
    const crumbs = []
    let currentPath = ''

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      currentPath += `/${segment}`

      // Format label: capitalize
      let label = segment.charAt(0).toUpperCase() + segment.slice(1)

      // Special handling if numeric (Week) logic could go here, but keeping simple
      if (i === 3) {
        // Week segment
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
        {crumbs.map((crumb, _index) => (
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
