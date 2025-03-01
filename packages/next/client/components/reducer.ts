import type { CacheNode } from '../../shared/lib/app-router-context'
import type {
  FlightRouterState,
  FlightData,
  FlightDataPath,
} from '../../server/app-render'
import { matchSegment } from './match-segments'
import { fetchServerResponse } from './app-router.client'

const fillCacheWithNewSubTreeData = (
  newCache: CacheNode,
  existingCache: CacheNode,
  flightDataPath: FlightDataPath
) => {
  const isLastEntry = flightDataPath.length <= 4
  const [parallelRouteKey, segment] = flightDataPath

  const segmentForCache = Array.isArray(segment) ? segment[1] : segment

  const existingChildSegmentMap =
    existingCache.parallelRoutes.get(parallelRouteKey)

  if (!existingChildSegmentMap) {
    // Bailout because the existing cache does not have the path to the leaf node
    // Will trigger lazy fetch in layout-router because of missing segment
    return
  }

  let childSegmentMap = newCache.parallelRoutes.get(parallelRouteKey)
  if (!childSegmentMap || childSegmentMap === existingChildSegmentMap) {
    childSegmentMap = new Map(existingChildSegmentMap)
    newCache.parallelRoutes.set(parallelRouteKey, childSegmentMap)
  }

  const existingChildCacheNode = existingChildSegmentMap.get(segmentForCache)
  let childCacheNode = childSegmentMap.get(segmentForCache)

  // In case of last segment start off the fetch at this level and don't copy further down.
  if (isLastEntry) {
    if (
      !childCacheNode ||
      !childCacheNode.data ||
      childCacheNode === existingChildCacheNode
    ) {
      childSegmentMap.set(segmentForCache, {
        data: null,
        subTreeData: flightDataPath[3],
        parallelRoutes: new Map(),
      })
    }
    return
  }

  if (!childCacheNode || !existingChildCacheNode) {
    // Bailout because the existing cache does not have the path to the leaf node
    // Will trigger lazy fetch in layout-router because of missing segment
    return
  }

  if (childCacheNode === existingChildCacheNode) {
    childCacheNode = {
      data: childCacheNode.data,
      subTreeData: childCacheNode.subTreeData,
      parallelRoutes: new Map(childCacheNode.parallelRoutes),
    }
    childSegmentMap.set(segmentForCache, childCacheNode)
  }

  fillCacheWithNewSubTreeData(
    childCacheNode,
    existingChildCacheNode,
    flightDataPath.slice(2)
  )
}

const fillCacheWithDataProperty = (
  newCache: CacheNode,
  existingCache: CacheNode,
  segments: string[],
  fetchResponse: any
): { bailOptimistic: boolean } | undefined => {
  const isLastEntry = segments.length === 1

  const parallelRouteKey = 'children'
  const [segment] = segments

  const existingChildSegmentMap =
    existingCache.parallelRoutes.get(parallelRouteKey)

  if (!existingChildSegmentMap) {
    // Bailout because the existing cache does not have the path to the leaf node
    // Will trigger lazy fetch in layout-router because of missing segment
    return { bailOptimistic: true }
  }

  let childSegmentMap = newCache.parallelRoutes.get(parallelRouteKey)

  if (!childSegmentMap || childSegmentMap === existingChildSegmentMap) {
    childSegmentMap = new Map(existingChildSegmentMap)
    newCache.parallelRoutes.set(parallelRouteKey, childSegmentMap)
  }

  const existingChildCacheNode = existingChildSegmentMap.get(segment)
  let childCacheNode = childSegmentMap.get(segment)

  // In case of last segment start off the fetch at this level and don't copy further down.
  if (isLastEntry) {
    if (
      !childCacheNode ||
      !childCacheNode.data ||
      childCacheNode === existingChildCacheNode
    ) {
      childSegmentMap.set(segment, {
        data: fetchResponse(),
        subTreeData: null,
        parallelRoutes: new Map(),
      })
    }
    return
  }

  if (!childCacheNode || !existingChildCacheNode) {
    // Start fetch in the place where the existing cache doesn't have the data yet.
    if (!childCacheNode) {
      childSegmentMap.set(segment, {
        data: fetchResponse(),
        subTreeData: null,
        parallelRoutes: new Map(),
      })
    }
    return
  }

  if (childCacheNode === existingChildCacheNode) {
    childCacheNode = {
      data: childCacheNode.data,
      subTreeData: childCacheNode.subTreeData,
      parallelRoutes: new Map(childCacheNode.parallelRoutes),
    }
    childSegmentMap.set(segment, childCacheNode)
  }

  return fillCacheWithDataProperty(
    childCacheNode,
    existingChildCacheNode,
    segments.slice(1),
    fetchResponse
  )
}

const canOptimisticallyRender = (
  segments: string[],
  flightRouterState: FlightRouterState
): boolean => {
  const segment = segments[0]
  const isLastSegment = segments.length === 1

  const [existingSegment, existingParallelRoutes, , , loadingMarker] =
    flightRouterState

  const hasLoading = loadingMarker === 'loading'

  // If the tree path holds at least one loading.js it will be optimistic
  if (hasLoading) {
    return true
  }

  // Above already catches the last segment case where `hasLoading` is true, so in this case it would always be `false`.
  if (isLastSegment) {
    return false
  }

  // If the segments mismatch we can't resolve deeper into the tree
  const segmentMatches = matchSegment(existingSegment, segment)

  // If the existingParallelRoutes does not have a `children` parallelRouteKey we can't resolve deeper into the tree
  if (!segmentMatches || !existingParallelRoutes.children) {
    return hasLoading
  }

  // Resolve deeper in the tree as the current level did not have a loading marker
  return canOptimisticallyRender(
    segments.slice(1),
    existingParallelRoutes.children
  )
}

const createOptimisticTree = (
  segments: string[],
  flightRouterState: FlightRouterState | null,
  isFirstSegment: boolean,
  parentRefetch: boolean,
  href?: string
): FlightRouterState => {
  const [existingSegment, existingParallelRoutes] = flightRouterState || [
    null,
    {},
  ]
  const segment = segments[0]
  const isLastSegment = segments.length === 1

  const segmentMatches =
    existingSegment !== null && matchSegment(existingSegment, segment)
  const shouldRefetchThisLevel = !flightRouterState || !segmentMatches

  let parallelRoutes: FlightRouterState[1] = {}
  if (existingSegment !== null && segmentMatches) {
    parallelRoutes = existingParallelRoutes
  }

  let childTree
  if (!isLastSegment) {
    const childItem = createOptimisticTree(
      segments.slice(1),
      parallelRoutes ? parallelRoutes.children : null,
      false,
      parentRefetch || shouldRefetchThisLevel
    )

    childTree = childItem
  }

  const result: FlightRouterState = [
    segment,
    {
      ...parallelRoutes,
      ...(childTree ? { children: childTree } : {}),
    },
  ]

  if (!parentRefetch && shouldRefetchThisLevel) {
    result[3] = 'refetch'
  }

  // Add url into the tree
  if (isFirstSegment) {
    result[2] = href
  }

  // Copy the loading flag from existing tree
  if (flightRouterState && flightRouterState[4]) {
    result[4] = flightRouterState[4]
  }

  return result
}

const walkTreeWithFlightDataPath = (
  flightSegmentPath: FlightData[0],
  flightRouterState: FlightRouterState,
  treePatch: FlightRouterState
): FlightRouterState => {
  const [segment, parallelRoutes, url] = flightRouterState

  // Root refresh
  if (flightSegmentPath.length === 1) {
    const tree: FlightRouterState = [...treePatch]

    if (url) {
      tree[2] = url
    }

    return tree
  }

  const [currentSegment, parallelRouteKey] = flightSegmentPath

  // Tree path returned from the server should always match up with the current tree in the browser
  if (!matchSegment(currentSegment, segment)) {
    throw new Error('SEGMENT MISMATCH')
  }

  const lastSegment = flightSegmentPath.length === 2

  const tree: FlightRouterState = [
    flightSegmentPath[0],
    {
      ...parallelRoutes,
      [parallelRouteKey]: lastSegment
        ? treePatch
        : walkTreeWithFlightDataPath(
            flightSegmentPath.slice(2),
            parallelRoutes[parallelRouteKey],
            treePatch
          ),
    },
  ]

  if (url) {
    tree[2] = url
  }

  // Copy loading flag
  if (flightSegmentPath[4]) {
    tree[4] = flightSegmentPath[4]
  }

  return tree
}

type AppRouterState = {
  tree: FlightRouterState
  cache: CacheNode
  pushRef: { pendingPush: boolean; mpaNavigation: boolean }
  canonicalUrl: string
}

export function reducer(
  state: AppRouterState,
  action:
    | {
        type: 'reload'
        payload: {
          url: URL
          cache: CacheNode
          mutable: {
            previousTree?: FlightRouterState
            patchedTree?: FlightRouterState
          }
        }
      }
    | {
        type: 'navigate'
        payload: {
          url: URL
          cacheType: 'soft' | 'hard'
          navigateType: 'push' | 'replace'
          cache: CacheNode
          mutable: {
            previousTree?: FlightRouterState
            patchedTree?: FlightRouterState
          }
        }
      }
    | { type: 'restore'; payload: { url: URL; tree: FlightRouterState } }
    | {
        type: 'server-patch'
        payload: {
          flightData: FlightData
          previousTree: FlightRouterState
          cache: CacheNode
        }
      }
): AppRouterState {
  if (action.type === 'restore') {
    const { url, tree } = action.payload
    const href = url.pathname + url.search + url.hash

    return {
      canonicalUrl: href,
      pushRef: state.pushRef,
      cache: state.cache,
      tree: tree,
    }
  }

  if (action.type === 'navigate') {
    const { url, cacheType, navigateType, cache, mutable } = action.payload
    const pendingPush = navigateType === 'push' ? true : false
    const { pathname } = url
    const href = url.pathname + url.search + url.hash

    const segments = pathname.split('/')
    // TODO-APP: figure out something better for index pages
    segments.push('')

    // In case of soft push data fetching happens in layout-router if a segment is missing
    if (cacheType === 'soft') {
      const optimisticTree = createOptimisticTree(
        segments,
        state.tree,
        true,
        false,
        href
      )

      return {
        canonicalUrl: href,
        pushRef: { pendingPush, mpaNavigation: false },
        cache: state.cache,
        tree: optimisticTree,
      }
    }

    // When doing a hard push there can be two cases: with optimistic tree and without
    // The with optimistic tree case only happens when the layouts have a loading state (loading.js)
    // The without optimistic tree case happens when there is no loading state, in that case we suspend in this reducer
    if (cacheType === 'hard') {
      if (
        mutable.patchedTree &&
        JSON.stringify(mutable.previousTree) === JSON.stringify(state.tree)
      ) {
        return {
          canonicalUrl: href,
          pushRef: { pendingPush, mpaNavigation: false },
          cache: cache,
          tree: mutable.patchedTree,
        }
      }

      // TODO-APP: flag on the tree of which part of the tree for if there is a loading boundary
      const isOptimistic = canOptimisticallyRender(segments, state.tree)

      if (isOptimistic) {
        // Build optimistic tree
        // If the optimistic tree is deeper than the current state leave that deeper part out of the fetch
        const optimisticTree = createOptimisticTree(
          segments,
          state.tree,
          true,
          false,
          href
        )

        // Fill in the cache with blank that holds the `data` field.
        // TODO-APP: segments.slice(1) strips '', we can get rid of '' altogether.
        cache.subTreeData = state.cache.subTreeData
        const res = fillCacheWithDataProperty(
          cache,
          state.cache,
          segments.slice(1),
          () => {
            return fetchServerResponse(url, optimisticTree)
          }
        )

        if (!res?.bailOptimistic) {
          mutable.previousTree = state.tree
          mutable.patchedTree = optimisticTree
          return {
            canonicalUrl: href,
            pushRef: { pendingPush, mpaNavigation: false },
            cache: cache,
            tree: optimisticTree,
          }
        }
      }

      if (!cache.data) {
        cache.data = fetchServerResponse(url, state.tree)
      }
      const flightData = cache.data.readRoot()

      // Handle case when navigating to page in `pages` from `app`
      if (typeof flightData === 'string') {
        return {
          canonicalUrl: flightData,
          pushRef: { pendingPush: true, mpaNavigation: true },
          cache: state.cache,
          tree: state.tree,
        }
      }

      cache.data = null

      // TODO-APP: ensure flightDataPath does not have "" as first item
      const flightDataPath = flightData[0]

      const [treePatch] = flightDataPath.slice(-2)
      const treePath = flightDataPath.slice(0, -3)
      const newTree = walkTreeWithFlightDataPath(
        // TODO-APP: remove ''
        ['', ...treePath],
        state.tree,
        treePatch
      )

      mutable.previousTree = state.tree
      mutable.patchedTree = newTree

      cache.subTreeData = state.cache.subTreeData
      fillCacheWithNewSubTreeData(cache, state.cache, flightDataPath)

      return {
        canonicalUrl: href,
        pushRef: { pendingPush, mpaNavigation: false },
        cache: cache,
        tree: newTree,
      }
    }

    return state
  }

  if (action.type === 'server-patch') {
    const { flightData, previousTree, cache } = action.payload
    if (JSON.stringify(previousTree) !== JSON.stringify(state.tree)) {
      // TODO-APP: Handle tree mismatch
      console.log('TREE MISMATCH')
      return {
        canonicalUrl: state.canonicalUrl,
        pushRef: state.pushRef,
        tree: state.tree,
        cache: state.cache,
      }
    }

    // Handle case when navigating to page in `pages` from `app`
    if (typeof flightData === 'string') {
      return {
        canonicalUrl: flightData,
        pushRef: { pendingPush: true, mpaNavigation: true },
        cache: state.cache,
        tree: state.tree,
      }
    }

    // TODO-APP: flightData could hold multiple paths
    const flightDataPath = flightData[0]

    // Slices off the last segment (which is at -3) as it doesn't exist in the tree yet
    const treePath = flightDataPath.slice(0, -3)
    const [treePatch] = flightDataPath.slice(-2)

    const newTree = walkTreeWithFlightDataPath(
      // TODO-APP: remove ''
      ['', ...treePath],
      state.tree,
      treePatch
    )

    cache.subTreeData = state.cache.subTreeData
    fillCacheWithNewSubTreeData(cache, state.cache, flightDataPath)

    return {
      canonicalUrl: state.canonicalUrl,
      pushRef: state.pushRef,
      tree: newTree,
      cache: cache,
    }
  }

  if (action.type === 'reload') {
    const { url, cache, mutable } = action.payload
    const href = url.pathname + url.search + url.hash
    const pendingPush = false

    // When doing a hard push there can be two cases: with optimistic tree and without
    // The with optimistic tree case only happens when the layouts have a loading state (loading.js)
    // The without optimistic tree case happens when there is no loading state, in that case we suspend in this reducer

    if (
      mutable.patchedTree &&
      JSON.stringify(mutable.previousTree) === JSON.stringify(state.tree)
    ) {
      return {
        canonicalUrl: href,
        pushRef: { pendingPush, mpaNavigation: false },
        cache: cache,
        tree: mutable.patchedTree,
      }
    }

    if (!cache.data) {
      cache.data = fetchServerResponse(url, [
        state.tree[0],
        state.tree[1],
        state.tree[2],
        'refetch',
      ])
    }
    const flightData = cache.data.readRoot()

    // Handle case when navigating to page in `pages` from `app`
    if (typeof flightData === 'string') {
      return {
        canonicalUrl: flightData,
        pushRef: { pendingPush: true, mpaNavigation: true },
        cache: state.cache,
        tree: state.tree,
      }
    }

    cache.data = null

    const flightDataPath = flightData[0]

    if (flightDataPath.length !== 2) {
      // TODO-APP: handle this case better
      console.log('RELOAD FAILED')
      return state
    }

    const [treePatch, subTreeData] = flightDataPath.slice(-2)
    const newTree = walkTreeWithFlightDataPath(
      // TODO-APP: remove ''
      [''],
      state.tree,
      treePatch
    )

    mutable.previousTree = state.tree
    mutable.patchedTree = newTree

    cache.subTreeData = subTreeData

    return {
      canonicalUrl: href,
      pushRef: { pendingPush, mpaNavigation: false },
      cache: cache,
      tree: newTree,
    }
  }

  return state
}
