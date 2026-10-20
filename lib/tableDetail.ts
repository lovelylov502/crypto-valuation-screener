import { fundamentalErrors } from "./fundamentalContract";
import { tableIdentity, type TableDetail } from "./tableDto";

/** The full evidence response must belong to the exact row the user opened. */
export function validateTableDetail(value: unknown, expected: { slug: string; identity: string; publicationId: string; snapshotSha256: string; updatedAt: string }): TableDetail {
  const result = value as TableDetail;
  if (!result || result.schema !== 1 || result.publicationId !== expected.publicationId || result.snapshotSha256 !== expected.snapshotSha256 || result.updatedAt !== expected.updatedAt
    || result.identity !== expected.identity || !result.coin || result.coin.slug !== expected.slug || tableIdentity(result.coin) !== expected.identity || fundamentalErrors(result.coin).length) throw Error("상세 자료와 목록의 검증본이 다릅니다. 목록을 새로 불러와 주세요.");
  return result;
}
