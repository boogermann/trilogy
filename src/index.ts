import { dirname, resolve } from 'path'
import { openSync, closeSync } from 'fs'

import * as knex from 'knex'

import Model from './model'
import { runQuery } from './helpers'
import { toKnexSchema } from './schema-helpers'
import { connect, readDatabase } from './sqljs-handler'
import { invariant, makeDirPath } from './util'

import { Pool } from 'generic-pool'
import { Database } from 'sql.js'
import * as types from './types'

// @ts-ignore: throwaway reference to satisfy compiler
import * as t from 'io-ts'

export type ModelPlugin = (model: typeof Model) => typeof Model

export interface PluginContext {
  instance: Trilogy,
  extend: (object: types.ObjectLiteral) => any,
  extendModel: (fn: ModelPlugin) => any
}

export type Plugin = (context: PluginContext) => any

const mixPlugins = (parent: typeof Model, mixins: Set<ModelPlugin>): typeof Model => {
  let result = parent

  let i = 0
  for (const mixin of mixins) {
    const child = mixin(result)
    invariant(
      child instanceof parent,
      `Model plugins must extend Model (plugin at index ${i})`
    )
    result = child
    i += 1
  }

  return result
}

const ensureExists = (atPath: string) => {
  try {
    closeSync(openSync(atPath, 'wx'))
  } catch (e) {}
}

export class Trilogy {
  isNative: boolean
  knex: knex
  Model: typeof Model
  options: types.TrilogyOptions
  pool: Pool<Database>
  verbose?: (query: string) => any

  private _definitions: Map<string, Model<any>>
  private _modelPlugins: Set<ModelPlugin>

  constructor (path: string, options: types.TrilogyOptions = {}) {
    invariant(path, 'trilogy constructor must be provided a file path')

    const obj = this.options =
      types.validate(options, types.TrilogyOptions)

    if (path === ':memory:') {
      obj.connection.filename = path
    } else {
      obj.connection.filename = resolve(obj.dir, path)

      // ensure the directory exists
      makeDirPath(dirname(obj.connection.filename))
    }

    this.isNative = obj.client === 'sqlite3'
    this.verbose = (obj.verbose as (query: string) => any)

    const config = { client: 'sqlite3', useNullAsDefault: true }

    if (this.isNative) {
      if (path !== ':memory:') {
        ensureExists(obj.connection.filename)
      }

      this.knex = knex(({ ...config, connection: obj.connection } as knex.Config))
    } else {
      this.knex = knex(config)
      this.pool = connect(this)
      readDatabase(this)
    }

    this._definitions = new Map()
    this._modelPlugins = new Set()
  }

  use (plugin: Plugin) {
    invariant(
      typeof plugin === 'function',
      'trilogy plugins must be of type function'
    )

    plugin({
      instance: this,

      extend: (object: types.ObjectLiteral) => {
        for (const key of Object.keys(object)) {
          if (this[key] != null) continue

          const value = object[key]
          if (typeof value === 'function') {
            this[key] = value.bind(this)
          } else {
            this[key] = value
          }
        }
      },

      extendModel: (fn: ModelPlugin) => {
        this._modelPlugins.add(fn)
      }
    })

    return this
  }

  get models () {
    return [...this._definitions.keys()]
  }

  async model <D = types.ObjectLiteral> (
    name: string,
    schema: types.SchemaRaw,
    options: types.ModelOptions = {}
  ): Promise<Model<D>> {
    if (this._definitions.has(name)) {
      return this._definitions.get(name)
    }

    const ModelClass = mixPlugins(Model, this._modelPlugins)
    const model = new ModelClass<D>(this, name, schema, options)

    this._definitions.set(name, model)

    const opts = toKnexSchema(
      model,
      types.validate(options, types.ModelOptions, {})
    )
    const check = this.knex.schema.hasTable(name)
    const query = this.knex.schema.createTable(name, opts)

    if (this.isNative) {
      // tslint:disable-next-line:await-promise
      const exists = await check
      return exists ? model : query.then(() => model)
    } else {
      const exists = await runQuery(this, check, true)
      if (exists) return model
      return runQuery(this, query).then(() => model)
    }
  }

  getModel <D = types.ObjectLiteral> (name: string): Model<D> | never
  getModel (name: string): Model | never {
    return invariant(
      this._definitions.get(name),
      `no model defined by the name '${name}'`
    )
  }

  async hasModel (name: string): Promise<boolean> {
    if (!this._definitions.has(name)) {
      return false
    }

    const query = this.knex.schema.hasTable(name)
    return runQuery(this, query, true)
  }

  async dropModel (name: string): Promise<boolean> {
    if (!this._definitions.has(name)) {
      return false
    }

    const query = this.knex.schema.dropTableIfExists(name)
    await runQuery(this, query, true)
    this._definitions.delete(name)
    return true
  }

  raw (query: knex.QueryBuilder | knex.Raw, needResponse?: boolean) {
    return runQuery(this, query, needResponse)
  }

  close () {
    if (this.isNative) {
      // must wrap this return value in native Promise due to
      // https://github.com/petkaantonov/bluebird/issues/1277
      return Promise.resolve(this.knex.destroy())
    } else {
      return this.pool.drain()
    }
  }

  create <T = types.ObjectLiteral> (
    table: string,
    object: types.ObjectLiteral,
    options?: types.ObjectLiteral
  ): Promise<T>
  create (
    table: string,
    object: types.ObjectLiteral,
    options?: types.ObjectLiteral
  ) {
    const model = this.getModel(table)
    return model.create(object, options)
  }

  find <T = types.ObjectLiteral> (
    location: string,
    criteria?: types.Criteria,
    options?: types.FindOptions
  ): Promise<T[]>
  find (
    location: string,
    criteria?: types.Criteria,
    options?: types.FindOptions
  ) {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.find(column, criteria, options)
  }

  findOne <T = types.ObjectLiteral> (
    location: string,
    criteria?: types.Criteria,
    options?: types.FindOptions
  ): Promise<T>
  findOne (
    location: string,
    criteria?: types.Criteria,
    options?: types.FindOptions
  ) {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.findOne(column, criteria, options)
  }

  findOrCreate <T = types.ObjectLiteral> (
    table: string,
    criteria: types.Criteria,
    creation?: types.ObjectLiteral,
    options?: types.FindOptions
  ): Promise<T>
  findOrCreate (
    table: string,
    criteria: types.Criteria,
    creation?: types.ObjectLiteral,
    options?: types.FindOptions
  ) {
    const model = this.getModel(table)
    return model.findOrCreate(criteria, creation, options)
  }

  update (
    table: string,
    criteria: types.Criteria,
    data: types.ObjectLiteral,
    options?: types.UpdateOptions
  ) {
    const model = this.getModel(table)
    return model.update(criteria, data, options)
  }

  updateOrCreate (
    table: string,
    criteria: types.Criteria,
    data: types.ObjectLiteral,
    options?: types.CreateOptions & types.UpdateOptions
  ) {
    const model = this.getModel(table)
    return model.updateOrCreate(criteria, data, options)
  }

  get <T = types.ReturnType> (
    location: string,
    criteria: types.Criteria,
    defaultValue?: T): Promise<T>
  get (
    location: string,
    criteria: types.Criteria,
    defaultValue?: any
  ): Promise<any> {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.get(column, criteria, defaultValue)
  }

  set <T> (location: string, criteria: types.Criteria, value: T) {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.set(column, criteria, value)
  }

  getRaw <T> (location: string, criteria: types.Criteria, defaultValue: T): Promise<T>
  getRaw (location: string, criteria: types.Criteria): Promise<types.ReturnType>
  getRaw (
    location: string,
    criteria: types.Criteria,
    defaultValue?: any
  ): Promise<any> {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.getRaw(column, criteria, defaultValue)
  }

  setRaw <T> (location: string, criteria: types.Criteria, value: T) {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.setRaw(column, criteria, value)
  }

  incr (location: string, criteria: types.Criteria, amount?: number) {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.incr(column, criteria, amount)
  }

  decr (
    location: string,
    criteria: types.Criteria,
    amount?: number,
    allowNegative?: boolean
  ) {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.decr(column, criteria, amount, allowNegative)
  }

  remove (location: string, criteria: types.Criteria) {
    const model = this.getModel(location)
    return model.remove(criteria)
  }

  clear (location: string) {
    const model = this.getModel(location)
    return model.clear()
  }

  count (
    location?: string,
    criteria?: types.Criteria,
    options?: types.AggregateOptions
  ): Promise<number> {
    if (location == null && criteria == null && options == null) {
      const query = this.knex('sqlite_master')
        .whereNot('name', 'sqlite_sequence')
        .where({ type: 'table' })
        .count('* as count')

      return runQuery(this, query, true)
        .then(([{ count }]) => count)
    }

    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return column
      ? model.count(column, criteria, options)
      : model.count(criteria, options)
  }

  min (location: string, criteria: types.Criteria, options?: types.AggregateOptions) {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.min(column, criteria, options)
  }

  max (location: string, criteria: types.Criteria, options?: types.AggregateOptions) {
    const [table, column] = location.split('.', 2)
    const model = this.getModel(table)
    return model.max(column, criteria, options)
  }
}

export { default as Model } from './model'
export * from './types'

export const create = (path: string, options?: types.TrilogyOptions) => new Trilogy(path, options)
