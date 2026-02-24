import { gql } from 'graphql-request';

// Get names owned by address (filter on ownerAddress: Bytes!, not owner: User relation)
export const GET_NAMES_BY_OWNER = gql`
  query GetNamesByOwner($owner: Bytes!) {
    names(where: { ownerAddress: $owner }, orderBy: registeredAt, orderDirection: desc) {
      id
      name
      ownerAddress
      metaAddress
      registeredAt
      updatedAt
    }
  }
`;

// Get name by exact match
export const GET_NAME = gql`
  query GetName($name: String!) {
    names(where: { name: $name }, first: 1) {
      id
      name
      ownerAddress
      metaAddress
      registeredAt
      updatedAt
    }
  }
`;

// Get user profile with all data
export const GET_USER_PROFILE = gql`
  query GetUserProfile($address: ID!) {
    user(id: $address) {
      id
      registeredNamesCount
      names {
        id
        name
        metaAddress
        registeredAt
      }
      metaAddress {
        stealthMetaAddress
        schemeId
        registeredAt
      }
    }
  }
`;

// Get names by meta-address (for sponsored registrations where deployer is owner)
export const GET_NAMES_BY_META_ADDRESS = gql`
  query GetNamesByMetaAddress($metaAddress: Bytes!) {
    names(where: { metaAddress: $metaAddress }, orderBy: registeredAt, orderDirection: desc) {
      id
      name
      ownerAddress
      metaAddress
      registeredAt
      updatedAt
    }
  }
`;

// Search names by substring (for autocomplete)
export const SEARCH_NAMES = gql`
  query SearchNames($searchTerm: String!) {
    names(
      where: { name_contains: $searchTerm }
      first: 10
      orderBy: registeredAt
      orderDirection: desc
    ) {
      name
      ownerAddress
      metaAddress
    }
  }
`;

// Get a user's on-chain stealth meta-address AND owned names by wallet address.
// names is a @derivedFrom field on User — always populated when the user owns names,
// even if ERC-6538 was registered on a different chain (metaAddress will be null).
export const GET_STEALTH_META_BY_REGISTRANT = gql`
  query GetStealthMetaByRegistrant($address: ID!) {
    user(id: $address) {
      id
      names {
        id
        name
        ownerAddress
        metaAddress
        registeredAt
      }
      metaAddress {
        stealthMetaAddress
        schemeId
        registeredAt
      }
    }
  }
`;

/** Sanitize search input for Graph's name_contains filter (uses SQL LIKE under the hood) */
export function sanitizeSearchTerm(term: string): string {
  // Escape SQL LIKE wildcards that Graph passes through
  return term.replace(/[_%]/g, '');
}
