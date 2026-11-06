// MongoDB implementation of the store. Documents go in and out with string `_id`s;
// 24-hex ids are stored as real ObjectIds so data from other BiteVo apps lines up.
import { MongoClient, ObjectId } from 'mongodb';

const HEX24 = /^[0-9a-f]{24}$/i;
const toDbId = id => (typeof id === 'string' && HEX24.test(id) ? new ObjectId(id) : id);
const out = doc => (doc ? { ...doc, _id: String(doc._id) } : null);

function prepFilter(filter = {}) {
  if (!('_id' in filter)) return filter;
  const id = filter._id;
  return { ...filter, _id: id && typeof id === 'object' && Array.isArray(id.$in) ? { $in: id.$in.map(toDbId) } : toDbId(id) };
}

const withId = doc => ({ ...doc, _id: toDbId(doc._id ?? new ObjectId().toHexString()) });

export async function createMongoStore(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, appName: 'bitevo-admin' });
  await client.connect();
  const db = client.db(dbName);
  const col = name => db.collection(name);

  return {
    kind: 'mongodb',
    label: `MongoDB (${dbName})`,

    async find(name, filter = {}, { sort, limit, projection } = {}) {
      let cursor = col(name).find(prepFilter(filter), projection ? { projection } : {});
      if (sort) cursor = cursor.sort(sort);
      if (limit) cursor = cursor.limit(limit);
      return (await cursor.toArray()).map(out);
    },
    async findOne(name, filter = {}) {
      return out(await col(name).findOne(prepFilter(filter)));
    },
    async findById(name, id) {
      return out(await col(name).findOne({ _id: toDbId(id) }));
    },
    async insert(name, doc) {
      const d = withId(doc);
      await col(name).insertOne(d);
      return out(d);
    },
    async insertMany(name, docs) {
      if (docs.length) await col(name).insertMany(docs.map(withId), { ordered: false });
    },
    // Sets fields (and optionally appends `push: { field: item }`). Returns the updated document.
    async update(name, id, set = {}, { push } = {}) {
      const ops = {};
      if (Object.keys(set).length) ops.$set = set;
      if (push) ops.$push = push;
      return out(await col(name).findOneAndUpdate({ _id: toDbId(id) }, ops, { returnDocument: 'after' }));
    },
    async updateMany(name, filter, set) {
      return (await col(name).updateMany(prepFilter(filter), { $set: set })).modifiedCount;
    },
    async remove(name, id) {
      return (await col(name).deleteOne({ _id: toDbId(id) })).deletedCount > 0;
    },
    async count(name, filter = {}) {
      return col(name).countDocuments(prepFilter(filter));
    },
    async collectionNames() {
      return (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name);
    },
    async drop(name) {
      await col(name).drop().catch(() => {});
    },
    async ensureIndexes(specs) {
      for (const [name, keys, options] of specs) await col(name).createIndex(keys, options);
    },
    // A MongoDB change stream on one collection (live.js): every write to it, by any of BiteVo's APIs.
    watch(name, pipeline = [], options = {}) {
      return col(name).watch(pipeline, options);
    },
    async close() {
      await client.close();
    },
  };
}
