export class NameResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = "NameResolutionError";
  }
}

const normalize = (value) => value.trim().toLowerCase();

/**
 * Resolves a human-typed name to exactly one item from a list, the way a
 * person reading Shopify's admin would expect: an exact (case-insensitive)
 * match wins outright; otherwise a unique substring match is used. Zero or
 * multiple candidates at either stage is an error - this never guesses.
 */
export function resolveByName(items, name, getName) {
  const target = normalize(name);

  const exactMatches = items.filter((item) => normalize(getName(item)) === target);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw new NameResolutionError(
      `Multiple exact matches for "${name}": ${exactMatches.map(getName).join(", ")}`
    );
  }

  const substringMatches = items.filter((item) => normalize(getName(item)).includes(target));
  if (substringMatches.length === 1) return substringMatches[0];
  if (substringMatches.length === 0) {
    throw new NameResolutionError(`No match found for "${name}"`);
  }
  throw new NameResolutionError(
    `Multiple matches for "${name}": ${substringMatches.map(getName).join(", ")}`
  );
}
