import { dirname } from 'path'
import { mkdirSync, statSync } from 'fs'

import * as type from 'component-type'

import * as types from './types'

export function eachObj <T extends object, K extends keyof T> (
  collection: T,
  fn: (value: T[K], key: string, collection: T) => any
) {
  const keys = Object.keys(collection)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = collection[key]
    if (fn(value, key, collection) === false) break
  }
}

export function mapObj <T extends object, K extends keyof T> (
  collection: T,
  fn: (value: T[K], key: string, collection: T) => any
): { [key: string]: T[K] } {
  const result = {}
  eachObj(collection, (value, key, collection) => {
    result[key] = fn(value, key, collection)
  })

  return result
}

export function isType (value): string
export function isType (value, kind: string): boolean
export function isType (value, kind?: string) {
  if (!kind) return type(value)
  return type(value) === kind.toLowerCase()
}

export const isArray = (value): value is any[] => isType(value, 'array')
export const isObject = (value): value is types.ObjectLiteral => isType(value, 'object')
export const isFunction = (value): value is Function => isType(value, 'function')
export const isString = (value): value is string => isType(value, 'string')
export const isNumber = (value): value is number => isType(value, 'number')
export const isNil = (value): value is undefined | null => value == null

export const defaultTo = <T, V> (value: T, fallback: V) => isNil(value) ? fallback : value

export class TrilogyError extends Error {
  framesToPop: number

  constructor (message: string) {
    super(message)
    this.name = 'TrilogyError'
    this.framesToPop = 1
  }
}

export function invariant <T> (condition: T, message?: string): T | never {
  if (!condition) {
    throw new TrilogyError(message || 'Invariant Violation')
  }

  return condition
}

export function makeDirPath (path: string): boolean {
  const mode = parseInt('0777', 8)

  try {
    mkdirSync(path, mode)
    return true
  } catch (err) {
    if (err.code === 'EEXIST') {
      return statSync(path).isDirectory()
    }

    if (err.code === 'ENOENT') {
      const target = dirname(path)
      return (
        target !== path &&
        makeDirPath(target) &&
        (mkdirSync(path, mode) || true)
      )
    }

    return false
  }
}
