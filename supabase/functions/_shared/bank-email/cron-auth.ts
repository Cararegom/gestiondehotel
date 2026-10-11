export function bankCronAuthorized(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET') || '';
  if (expected.length < 24) return false;
  const explicit = req.headers.get('x-cron-secret') || '';
  const bearer = /^Bearer\s+([^\s]+)$/iu.exec(req.headers.get('authorization') || '')?.[1] || '';
  const supplied = explicit || bearer;
  let difference = expected.length ^ supplied.length;
  for (let i = 0; i < Math.max(expected.length, supplied.length); i += 1) difference |= (expected.charCodeAt(i) || 0) ^ (supplied.charCodeAt(i) || 0);
  return difference === 0;
}
