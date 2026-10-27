import { expect } from 'vitest'
import { app, TEST_ORIGIN } from './node-env'
import { CSRF_HEADER } from '../middleware/csrf'
import type { ListFoodResponse } from '../../shared/food'
import { categoryResponseSchema, type CategoryResponse } from '../../shared/gear'
import type { ListItemResponse, ListResponse, PackingLocationResponse } from '../../shared/lists'

const ORIGIN = TEST_ORIGIN

// Authenticated (or anon, cookie=null) JSON request through the real app,
// with the CSRF header the SPA's fetch wrapper always sends.
export async function apiRequest(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    [CSRF_HEADER]: '1',
    ...extraHeaders,
  }
  if (cookie) headers.Cookie = cookie
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return app.request(
    path,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  )
}

// Setup requests shared by the API test files. Each asserts the status its
// callers relied on before it moved here, and casts the body (no schema
// parse), as they did. A file whose copy checked something different keeps
// its own helper under its own name.

export async function userIdFor(cookie: string): Promise<string> {
  const res = await apiRequest(cookie, 'GET', '/api/me')
  return ((await res.json()) as { id: string }).id
}

export async function createList(cookie: string, name: string): Promise<ListResponse> {
  const res = await apiRequest(cookie, 'POST', '/api/lists', { name })
  expect(res.status).toBe(201)
  return (await res.json()) as ListResponse
}

export async function getLists(cookie: string): Promise<ListResponse[]> {
  const res = await apiRequest(cookie, 'GET', '/api/lists')
  expect(res.status).toBe(200)
  return (await res.json()) as ListResponse[]
}

// A gear item with only a name; returns its id.
export async function createGearItemId(cookie: string, name: string): Promise<string> {
  const res = await apiRequest(cookie, 'POST', '/api/gear-items', { name })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

export async function addListItem(
  cookie: string,
  listId: string,
  gearItemId: string,
): Promise<ListItemResponse> {
  const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/items`, { gearItemId })
  expect(res.status).toBe(201)
  return (await res.json()) as ListItemResponse
}

export async function getListItems(cookie: string, listId: string): Promise<ListItemResponse[]> {
  const res = await apiRequest(cookie, 'GET', `/api/lists/${listId}/items`)
  expect(res.status).toBe(200)
  return (await res.json()) as ListItemResponse[]
}

export async function createPackingLocation(
  cookie: string,
  listId: string,
  name: string,
): Promise<PackingLocationResponse> {
  const res = await apiRequest(cookie, 'POST', `/api/lists/${listId}/packing-locations`, { name })
  expect(res.status).toBe(201)
  return (await res.json()) as PackingLocationResponse
}

export async function getListFood(cookie: string, listId: string): Promise<ListFoodResponse> {
  const res = await apiRequest(cookie, 'GET', `/api/lists/${listId}/food`)
  expect(res.status).toBe(200)
  return (await res.json()) as ListFoodResponse
}

// Parsed with the response schema and no status check, as both callers did.
export async function listCategories(cookie: string): Promise<CategoryResponse[]> {
  const res = await apiRequest(cookie, 'GET', '/api/categories')
  return categoryResponseSchema.array().parse(await res.json())
}
