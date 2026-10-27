// UI-facing row types. These ARE the shared API DTOs - one source of
// truth, camelCase end-to-end. The aliases give components one import path.
export type { Category } from './queries/categories'
export type { GearItem } from './queries/gear'
export type { GearStatus } from '../../shared/gear'
export type { List } from './queries/lists'
export type { ListItemWithGear } from './queries/list-items'
export type { PackingLocationResponse as PackingLocation } from '../../shared/lists'
// The public /r/:slug wire shape - the strict share-view allowlist. SharePage
// maps it to the wide types above at ONE boundary point so the shared
// rendering components keep unified signatures.
export type { SharedListResponse } from '../../shared/shares'
