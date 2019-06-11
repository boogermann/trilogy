import { invariant } from './util'
import { normalizeCriteria } from './helpers'

import {
  Fn,
  Criteria,
  CriteriaNormalized,
  CreateOptions,
  UpdateOptions
} from './types'

export type HookOptions = CreateOptions | UpdateOptions | {}

export type OnQueryOptions = {
  includeInternal?: boolean
}

export type OnQueryContext = [string, boolean]

export type OnQueryCallback = Fn<[string]>
export type BeforeCreateCallback <D> = Fn<[D | Partial<D>, CreateOptions]>
export type AfterCreateCallback <D> = Fn<[D, CreateOptions]>
export type BeforeUpdateCallback <D> = Fn<[D | Partial<D>, CriteriaNormalized<D>, UpdateOptions]>
export type AfterUpdateCallback <D> = Fn<[D[], UpdateOptions]>
export type BeforeRemoveCallback <D> = Fn<[CriteriaNormalized<D>, {}]>
export type AfterRemoveCallback <D> = Fn<[D[], {}]>

export type HookCallback <D> =
  | OnQueryCallback
  | BeforeCreateCallback<D>
  | AfterCreateCallback<D>
  | BeforeUpdateCallback<D>
  | AfterUpdateCallback<D>
  | BeforeRemoveCallback<D>
  | AfterRemoveCallback<D>

export type HookResult = {
  prevented: boolean
}

export enum Hook {
  OnQuery = 'ON_QUERY',
  BeforeCreate = 'BEFORE_CREATE',
  AfterCreate = 'AFTER_CREATE',
  BeforeUpdate = 'BEFORE_UPDATE',
  AfterUpdate = 'AFTER_UPDATE',
  BeforeRemove = 'BEFORE_REMOVE',
  AfterRemove = 'AFTER_REMOVE'
}

export const EventCancellation = Symbol('trilogy.EventCancellation')

export class Hooks <D> {
  private _onQuery = new Set<OnQueryCallback>()
  private _onQueryAll = new Set<OnQueryCallback>()

  private _beforeCreate = new Set<BeforeCreateCallback<D>>()
  private _afterCreate = new Set<AfterCreateCallback<D>>()
  private _beforeUpdate = new Set<BeforeUpdateCallback<D>>()
  private _afterUpdate = new Set<AfterUpdateCallback<D>>()
  private _beforeRemove = new Set<BeforeRemoveCallback<D>>()
  private _afterRemove = new Set<AfterRemoveCallback<D>>()

  onQuery (fn: OnQueryCallback, options: OnQueryOptions = {}) {
    invariant(
      typeof fn === 'function',
      'hook callbacks must be of type function'
    )

    if (options.includeInternal) {
      this._onQuery.add(fn)
      this._onQueryAll.add(fn)
      return () =>
        this._onQueryAll.delete(fn) && this._onQuery.delete(fn)
    } else {
      this._onQuery.add(fn)
      return () => this._onQuery.delete(fn)
    }
  }

  beforeCreate (fn: BeforeCreateCallback<D>) {
    invariant(
      typeof fn === 'function',
      'hook callbacks must be of type function'
    )

    this._beforeCreate.add(fn)
    return () => this._beforeCreate.delete(fn)
  }

  afterCreate (fn: AfterCreateCallback<D>) {
    invariant(
      typeof fn === 'function',
      'hook callbacks must be of type function'
    )

    this._afterCreate.add(fn)
    return () => this._afterCreate.delete(fn)
  }

  beforeUpdate (fn: BeforeUpdateCallback<D>) {
    invariant(
      typeof fn === 'function',
      'hook callbacks must be of type function'
    )

    this._beforeUpdate.add(fn)
    return () => this._beforeUpdate.delete(fn)
  }

  afterUpdate (fn: AfterUpdateCallback<D>) {
    invariant(
      typeof fn === 'function',
      'hook callbacks must be of type function'
    )

    this._afterUpdate.add(fn)
    return () => this._afterUpdate.delete(fn)
  }

  beforeRemove (fn: BeforeRemoveCallback<D>) {
    invariant(
      typeof fn === 'function',
      'hook callbacks must be of type function'
    )

    this._beforeRemove.add(fn)
    return () => this._beforeRemove.delete(fn)
  }

  afterRemove (fn: AfterRemoveCallback<D>) {
    invariant(
      typeof fn === 'function',
      'hook callbacks must be of type function'
    )

    this._afterRemove.add(fn)
    return () => this._afterRemove.delete(fn)
  }

  async _callHook <T = D> (
    hook: Hook.OnQuery, arg: OnQueryContext
  ): Promise<HookResult>
  async _callHook <T = D> (
    hook: Hook.BeforeCreate, arg: T | Partial<T>, options?: CreateOptions
  ): Promise<HookResult>
  async _callHook <T = D> (
    hook: Hook.AfterCreate, arg: T, options?: CreateOptions
  ): Promise<HookResult>
  async _callHook <T = D> (
    hook: Hook.BeforeUpdate, arg: [T | Partial<T>, Criteria<T>], options?: UpdateOptions
  ): Promise<HookResult>
  async _callHook <T = D> (
    hook: Hook.AfterUpdate, arg: T[], options?: UpdateOptions
  ): Promise<HookResult>
  async _callHook <T = D> (
    hook: Hook.BeforeRemove, arg: Criteria<T>, options?: {}
  ): Promise<HookResult>
  async _callHook <T = D> (
    hook: Hook.AfterRemove, arg: T[], options?: {}
  ): Promise<HookResult>

  async _callHook <T = D> (
    hook: Hook,
    arg: T | Partial<T> | [T | Partial<T>, Criteria<T>] | Criteria<T> | OnQueryContext,
    options?: HookOptions
  ): Promise<HookResult> {
    const result: HookResult = {
      prevented: false
    }

    if (hook === Hook.OnQuery) {
      const [query, internal] = arg as OnQueryContext
      const fns = internal ? this._onQueryAll : this._onQuery

      for (const fn of fns) {
        if (await (fn as OnQueryCallback)(query) === EventCancellation) {
          result.prevented = true
        }
      }

      return result
    }

    const fns = ({
      [Hook.BeforeCreate]: this._beforeCreate,
      [Hook.AfterCreate]: this._afterCreate,
      [Hook.BeforeUpdate]: this._beforeUpdate,
      [Hook.AfterUpdate]: this._afterUpdate,
      [Hook.BeforeRemove]: this._beforeRemove,
      [Hook.AfterRemove]: this._afterRemove
    } as Record<Hook, Set<HookCallback<T>>>)[hook]

    for (const fn of fns) {
      let thisResult: unknown

      if (hook === Hook.BeforeUpdate) {
        const [data, criteria] = arg as [T | Partial<T>, Criteria<T>]
        thisResult = await (
          fn as BeforeUpdateCallback<T>
        )(data, normalizeCriteria(criteria), options || {})
      } else if (hook === Hook.BeforeRemove) {
        thisResult = await (
          fn as BeforeRemoveCallback<T>
        )(normalizeCriteria(arg as Criteria<T>), options || {})
      } else if (hook === Hook.BeforeCreate || hook === Hook.AfterCreate) {
        thisResult = await (
          fn as BeforeCreateCallback<T> | AfterCreateCallback<T>
        )(arg as T, options || {})
      } else {
        thisResult = await (
          fn as AfterUpdateCallback<T> | AfterRemoveCallback<T>
        )(arg as T[], options || {})
      }

      if (thisResult === EventCancellation) {
        result.prevented = true
      }
    }

    return result
  }
}
