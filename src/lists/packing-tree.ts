import type { ListItemWithGear, PackingLocation } from '../lib/types'

export type PackingTreeLocation = {
  location: PackingLocation
  containerItem: ListItemWithGear | null
  items: ListItemWithGear[]
  children: PackingTreeLocation[]
  /** Every checklist row rendered in this location's subtree, including its
   * own backing item. CategoryGroup uses this for parent-level pack progress. */
  packProgressItems: ListItemWithGear[]
}

export type PackingTree = {
  roots: PackingTreeLocation[]
  unassignedItems: ListItemWithGear[]
}

export function buildPackingTree(
  items: ListItemWithGear[],
  locations: PackingLocation[],
  options: { includeItem?: (item: ListItemWithGear) => boolean } = {},
): PackingTree {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const nodesById = new Map<string, PackingTreeLocation>()
  const containerItemIds = new Set<string>()

  for (const location of locations) {
    const sourceContainerItem = location.containerListItemId === null
      ? null
      : itemsById.get(location.containerListItemId) ?? null
    if (sourceContainerItem) containerItemIds.add(sourceContainerItem.id)
    const containerItem = sourceContainerItem
      && options.includeItem
      && !options.includeItem(sourceContainerItem)
      ? null
      : sourceContainerItem
    nodesById.set(location.id, {
      location,
      containerItem,
      items: [],
      children: [],
      packProgressItems: [],
    })
  }

  const proposedParents = new Map<string, string>()
  for (const node of nodesById.values()) {
    const parentId = node.containerItem?.packingLocationId
    if (parentId && parentId !== node.location.id && nodesById.has(parentId)) {
      proposedParents.set(node.location.id, parentId)
    }
  }

  // The API and database reject cycles. Optimistic cache state can still be
  // transiently inconsistent, so keep every member of a detected cycle at the
  // root instead of recursively rendering forever or making a subtree vanish.
  const cycleMembers = new Set<string>()
  for (const locationId of proposedParents.keys()) {
    const path: string[] = []
    const indexById = new Map<string, number>()
    let current: string | undefined = locationId
    while (current !== undefined) {
      const repeatedAt = indexById.get(current)
      if (repeatedAt !== undefined) {
        for (const member of path.slice(repeatedAt)) cycleMembers.add(member)
        break
      }
      indexById.set(current, path.length)
      path.push(current)
      current = proposedParents.get(current)
    }
  }

  const roots: PackingTreeLocation[] = []
  for (const node of nodesById.values()) {
    const parentId = cycleMembers.has(node.location.id)
      ? undefined
      : proposedParents.get(node.location.id)
    const parent = parentId ? nodesById.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const unassignedItems: ListItemWithGear[] = []
  for (const item of items) {
    if (containerItemIds.has(item.id)) continue
    if (options.includeItem && !options.includeItem(item)) continue
    const location = item.packingLocationId
      ? nodesById.get(item.packingLocationId)
      : undefined
    if (location) location.items.push(item)
    else unassignedItems.push(item)
  }

  const byItemOrder = (a: ListItemWithGear, b: ListItemWithGear) =>
    a.sortOrder - b.sortOrder
  const byLocationOrder = (a: PackingTreeLocation, b: PackingTreeLocation) =>
    a.location.sortOrder - b.location.sortOrder
  for (const node of nodesById.values()) {
    node.items.sort(byItemOrder)
    node.children.sort(byLocationOrder)
  }
  roots.sort(byLocationOrder)
  unassignedItems.sort(byItemOrder)

  function populatePackProgressItems(node: PackingTreeLocation): ListItemWithGear[] {
    const progressItems = [
      ...(node.containerItem ? [node.containerItem] : []),
      ...node.items,
    ]
    for (const child of node.children) {
      progressItems.push(...populatePackProgressItems(child))
    }
    node.packProgressItems = progressItems
    return progressItems
  }
  for (const root of roots) populatePackProgressItems(root)

  return { roots, unassignedItems }
}

export function buildContainerMoveExclusions(
  tree: PackingTree,
): Map<string, Set<string>> {
  const exclusions = new Map<string, Set<string>>()

  function visit(node: PackingTreeLocation): Set<string> {
    const subtreeLocationIds = new Set([node.location.id])
    for (const child of node.children) {
      for (const locationId of visit(child)) subtreeLocationIds.add(locationId)
    }
    if (node.containerItem) {
      exclusions.set(node.containerItem.id, subtreeLocationIds)
    }
    return subtreeLocationIds
  }

  for (const root of tree.roots) visit(root)
  return exclusions
}
