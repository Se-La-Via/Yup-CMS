import { buildSchema, type GraphQLScalarType } from "graphql";

/**
 * The GraphQL read schema. Pure — no database imports — so it can be built and
 * validated in isolation. Resolvers live in graphql.ts.
 *
 * `data` and `fields` are dynamic per content type, so they use a JSON scalar.
 */
const SDL = /* GraphQL */ `
  scalar JSON

  type ContentType {
    name: String!
    displayName: String!
    description: String
    requireApproval: Boolean!
    fields: JSON!
  }

  type Entry {
    id: ID!
    type: String!
    slug: String
    status: String!
    revision: Int!
    data: JSON!
    createdAt: String!
    updatedAt: String!
  }

  type Asset {
    id: ID!
    filename: String!
    contentType: String!
    size: Int!
    createdAt: String!
  }

  type Query {
    contentTypes: [ContentType!]!
    contentType(name: String!): ContentType
    entries(type: String!, status: String, limit: Int, offset: Int): [Entry!]!
    entry(id: ID!): Entry
    entryBySlug(type: String!, slug: String!, status: String): Entry
    assets(limit: Int): [Asset!]!
  }
`;

export const schema = buildSchema(SDL);

// Make the JSON scalar a passthrough for output (read-only API).
const jsonType = schema.getType("JSON") as GraphQLScalarType;
jsonType.serialize = (v) => v;
jsonType.parseValue = (v) => v;
