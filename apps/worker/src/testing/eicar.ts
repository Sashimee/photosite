// Kept as two halves: a naive AV signature match on the source tree must not fire here.
const EICAR_PARTS = [
  String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}`,
  '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
];

export function eicarTestString(): string {
  return EICAR_PARTS.join('');
}
