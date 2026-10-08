import type {EconomicProvenance} from "./economicTypes";

/** Browser-safe expectations; acquisition verifies these against the immutable reviewed contract. */
export const REVIEWED_LITERAL_REGISTRY_PROOF=Object.freeze({
 path:"helpers/chains.ts",
 projectionSha256:"4bc0cad98df20a343ab1459f630ca4c1af5013b0baead3aad7fe1006057c3063",
 consumerClosureSha256:"1b178f054eac3efb8d4ba0b9a18814f16a098886f92a8742c8139f2da88e653b",
});
export function registryDecisionProofMatches(proof:NonNullable<EconomicProvenance["runtime"]>["literalRegistry"]) {
 return proof?.path===REVIEWED_LITERAL_REGISTRY_PROOF.path&&proof.state==="matched"&&/^[a-f0-9]{40}$/.test(proof.actualBlobSha1??"")&&/^[a-f0-9]{64}$/.test(proof.rawSha256??"")&&proof.projectionSha256===REVIEWED_LITERAL_REGISTRY_PROOF.projectionSha256&&proof.consumerClosureSha256===REVIEWED_LITERAL_REGISTRY_PROOF.consumerClosureSha256&&Array.isArray(proof.addedMembers);
}
