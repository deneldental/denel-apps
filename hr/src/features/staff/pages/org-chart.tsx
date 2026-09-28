import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@denel/ui'
import { Loader2, Network, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { getOrgChart, type OrgChartNode } from '@/lib/actions/hr-phase2-4'
import { TagBadge } from '@/shared/components/tag-badge'

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]?.charAt(0).toUpperCase() ?? '?'
  return ((parts[0]?.charAt(0) ?? '') + (parts[parts.length - 1]?.charAt(0) ?? '')).toUpperCase()
}

type TreeNode = OrgChartNode & { children: TreeNode[] }

function buildTree(nodes: OrgChartNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  for (const n of nodes) map.set(n.id, { ...n, children: [] })
  const roots: TreeNode[] = []
  for (const node of map.values()) {
    if (node.managerId && map.has(node.managerId)) {
      map.get(node.managerId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortRecursive = (n: TreeNode) => {
    n.children.sort((a, b) => a.fullName.localeCompare(b.fullName))
    for (const child of n.children) sortRecursive(child)
  }
  roots.sort((a, b) => a.fullName.localeCompare(b.fullName))
  for (const r of roots) sortRecursive(r)
  return roots
}

function NodeCard({ node }: { node: TreeNode }) {
  return (
    <div className="space-y-2">
      <Link
        to={`/staff/${node.id}`}
        className="flex items-center gap-3 rounded-md border border-border bg-card p-2 hover:bg-muted/50"
      >
        <Avatar className="h-8 w-8">
          {node.profileImage ? (
            <AvatarImage src={node.profileImage} alt={node.fullName} />
          ) : (
            <AvatarFallback className="text-xs">{getInitials(node.fullName)}</AvatarFallback>
          )}
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{node.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{node.position || '—'}</p>
        </div>
        {node.staffType === 'external' && (
          <TagBadge className="ml-auto text-[10px]">external</TagBadge>
        )}
      </Link>
      {node.children.length > 0 && (
        <div className="ml-6 space-y-2 border-l border-dashed border-border pl-3">
          {node.children.map((child) => (
            <NodeCard key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function OrgChartPage() {
  const [nodes, setNodes] = useState<OrgChartNode[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const res = await getOrgChart()
      setLoading(false)
      if (!res.success || !Array.isArray(res.data)) {
        toast.error(res.error || 'Failed to load org chart')
        return
      }
      setNodes(res.data)
    })()
  }, [])

  const tree = useMemo(() => buildTree(nodes), [nodes])
  const unassigned = nodes.filter((n) => !n.managerId)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Org chart</h1>
        <p className="mt-1 text-muted-foreground">
          Reporting hierarchy across active staff. Set the direct manager on each staff profile.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4" />
            Reporting tree
          </CardTitle>
          <CardDescription>
            {nodes.length} active staff · {unassigned.length} at top level (no manager set)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : tree.length === 0 ? (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Users className="h-4 w-4" /> No staff to display.
            </div>
          ) : (
            <div className="space-y-3">
              {tree.map((root) => (
                <NodeCard key={root.id} node={root} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
