import type { InfrastructureGuess } from "./types";

/** Operators recognised in an ASN record, used only for an inferred hosting hint. */
export const OPERATOR_HINTS: { pattern: RegExp; name: string }[] = [
  { pattern: /amazon|aws|amazon-02|amazon-aes/i, name: "Amazon Web Services" },
  { pattern: /cloudflare/i, name: "Cloudflare" },
  { pattern: /google/i, name: "Google Cloud" },
  { pattern: /microsoft|azure/i, name: "Microsoft Azure" },
  { pattern: /akamai/i, name: "Akamai" },
  { pattern: /fastly/i, name: "Fastly" },
  { pattern: /digitalocean/i, name: "DigitalOcean" },
  { pattern: /hetzner/i, name: "Hetzner" },
  { pattern: /ovh/i, name: "OVH" },
  { pattern: /linode/i, name: "Linode" },
  { pattern: /github/i, name: "GitHub" },
  { pattern: /shopify/i, name: "Shopify" },
  { pattern: /automattic/i, name: "Automattic" },
  { pattern: /vercel/i, name: "Vercel" },
  { pattern: /netlify/i, name: "Netlify" },
];

/** Only evidence-backed announcing-network hints, never proof of the origin. */
export function inferNetworkInfrastructure(facts: { value: string; evidenceId: string }[]): InfrastructureGuess[] {
  const guesses = new Map<string, InfrastructureGuess>();
  for (const fact of facts) {
    for (const hint of OPERATOR_HINTS) {
      if (!hint.pattern.test(fact.value)) continue;
      const guess = guesses.get(hint.name) ?? {
        name: hint.name, confidence: "inferred", evidenceIds: [],
        explanation: "Inferred from the network that announces the observed address. This describes the announcing network, not necessarily where the content is hosted.",
      };
      if (!guess.evidenceIds.includes(fact.evidenceId)) guess.evidenceIds.push(fact.evidenceId);
      guesses.set(hint.name, guess);
    }
  }
  return [...guesses.values()];
}
