import type { NextRequest } from 'next/server';
export const dynamic = 'force-dynamic';
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.some((p) => !/^[a-zA-Z0-9_.-]+$/.test(p) || p === '.' || p === '..'))
    return Response.json({ error: { message: 'Invalid API path' } }, { status: 400 });
  const root = process.env.API_URL ?? 'http://127.0.0.1:4000',
    url = new URL(`/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, root);
  const headers = new Headers();
  for (const name of ['cookie', 'authorization', 'content-type', 'origin']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    let body: ArrayBuffer | undefined;
    if (!['GET', 'HEAD'].includes(request.method)) {
      const reader = request.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 2_000_000)
              return Response.json({ error: { message: 'Request too large' } }, { status: 413 });
            chunks.push(chunk.value);
          }
          body = new Uint8Array(Buffer.concat(chunks)).buffer;
        } finally {
          await reader.cancel();
        }
      }
    }
    const response = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(25000),
    });
    const outgoing = new Headers({
      'content-type': response.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    });
    const location = response.headers.get('location');
    if (location) outgoing.set('location', location);
    for (const value of response.headers.getSetCookie()) outgoing.append('set-cookie', value);
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json(
      {
        error: {
          code: 'API_UNAVAILABLE',
          message: 'The API is unavailable. Check the API service and API_URL.',
        },
      },
      { status: 503 },
    );
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
