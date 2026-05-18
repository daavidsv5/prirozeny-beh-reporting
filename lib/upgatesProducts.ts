// Shared Upgates product cache — imported by /api/stock and /api/brands.
// Module-level variable is shared across routes in the same Node.js process.

let _cache: { products: any[]; fetchedAt: number } | null = null;
const CACHE_TTL = 3_600_000; // 1 h

function authHeader() {
  const key = (process.env.UPGATES_API_KEY ?? '').replace(/^["']|["']$/g, '');
  return 'Basic ' + Buffer.from(`${process.env.UPGATES_LOGIN}:${key}`).toString('base64');
}

async function fetchPage(page: number): Promise<any> {
  const url = `${process.env.UPGATES_API_URL!.replace(/\/$/, '')}/products?page=${page}`;
  const res = await fetch(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Upgates /products HTTP ${res.status}`);
  return res.json();
}

export async function getProducts(): Promise<any[]> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL) return _cache.products;
  const first = await fetchPage(1);
  const pages: number = first.number_of_pages;
  let all: any[] = [...first.products];
  for (let p = 2; p <= pages; p++) {
    await new Promise(r => setTimeout(r, 300));
    const d = await fetchPage(p);
    all = all.concat(d.products);
  }
  _cache = { products: all, fetchedAt: Date.now() };
  return all;
}

export function czName(p: any): string {
  return ((p.descriptions as any[]) ?? []).find((d: any) => d.language === 'cs')?.title ?? p.code;
}
