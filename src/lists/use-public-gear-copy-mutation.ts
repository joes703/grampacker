import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  fetchCategories,
  fetchGearItems,
  fetchLists,
  importListFromCsv,
  nextListSortOrder,
  queryKeys,
} from '../lib/queries'
import type { Category, GearItem, List, PublicCategory, PublicList, PublicListItem } from '../lib/types'
import { copiedPublicListName, publicGearItemsToImportRows } from './public-gear-copy'

type PublicGearCopyInput = {
  list: PublicList
  items: PublicListItem[]
  categories: PublicCategory[]
}

export function usePublicGearCopyMutation(userId: string) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationKey: ['public-gear-copy', userId],
    meta: { errorToast: "Couldn't copy that gear list. Please try again." },
    mutationFn: async ({ list, items, categories }: PublicGearCopyInput) => {
      const rows = publicGearItemsToImportRows(items, categories)
      const [lists, gearItems, privateCategories] = await Promise.all([
        qc.fetchQuery<List[]>({ queryKey: queryKeys.lists(), queryFn: () => fetchLists(userId) }),
        qc.fetchQuery<GearItem[]>({ queryKey: queryKeys.gearItems(), queryFn: () => fetchGearItems(userId) }),
        qc.fetchQuery<Category[]>({ queryKey: queryKeys.categories(), queryFn: () => fetchCategories(userId) }),
      ])
      return importListFromCsv(
        userId,
        copiedPublicListName(list.name),
        rows,
        gearItems,
        privateCategories,
        nextListSortOrder(lists),
      )
    },
    onSuccess: (newList) => {
      qc.invalidateQueries({ queryKey: queryKeys.lists() })
      qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
      qc.invalidateQueries({ queryKey: queryKeys.categories() })
      navigate(`/lists/${newList.id}`)
    },
  })
}
