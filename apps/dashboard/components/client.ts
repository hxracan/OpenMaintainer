export type Item = Record<string, unknown>;
export function record(value: unknown): Item {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Item) : {};
}
export function string(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}
export function list(value: unknown): Item[] {
  return Array.isArray(value) ? value.map(record) : [];
}
export async function api(path: string, options?: RequestInit): Promise<Item> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    cache: 'no-store',
  });
  const body = record(await response.json());
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Sign in to continue'
        : string(record(body.error).message) || 'Request failed',
    );
  return body;
}
