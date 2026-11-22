export function clean(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

export function validateMember(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Each member must be an object.');
  const member = {};
  for (const field of ['first', 'last', 'class', 'email', 'address1', 'address2', 'city', 'state', 'zip', 'mobile', 'altPhone', 'currentDues']) {
    member[field] = clean(value[field]);
  }
  if (!member.last)
    throw Error('Each member needs a last name.');
  return member;
}

export function snapshotDate(value) {
  // .NET may emit seven fractional-second digits; normalize for Safari's Date parser.
  return new Date(value.replace(/(\.\d{3})\d+/, '$1'));
}

export function parseSnapshot(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object')
    throw Error('Choose an EBSC snapshot JSON file.');
  if (value.schemaVersion !== 1)
    throw Error(`Unsupported snapshot schema version: ${value.schemaVersion ?? 'missing'}.`);
  if (typeof value.exportedAt !== 'string' ||
      !Number.isFinite(snapshotDate(value.exportedAt).getTime()))
    throw Error('The snapshot has no valid export time.');
  if (!Array.isArray(value.members) || value.members.length === 0)
    throw Error('The snapshot contains no members.');
  return {
    members: value.members.map(validateMember),
    exportedAt: value.exportedAt
  };
}
