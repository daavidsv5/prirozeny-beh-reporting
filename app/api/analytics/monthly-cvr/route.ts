import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';

const client = new BetaAnalyticsDataClient({
  credentials: {
    client_email: process.env.GA4_CLIENT_EMAIL,
    private_key: process.env.GA4_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCvr(rows: any[]): number[] {
  const cvr = Array(12).fill(0);
  for (const row of rows) {
    const ym    = row.dimensionValues?.[0]?.value ?? '';
    const month = parseInt(ym.slice(4, 6), 10) - 1;
    if (month < 0 || month > 11) continue;
    const sessions    = Number(row.metricValues?.[0]?.value ?? 0);
    const conversions = Number(row.metricValues?.[1]?.value ?? 0);
    cvr[month] = sessions > 0 ? (conversions / sessions) * 100 : 0;
  }
  return cvr;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const yearA = Number(searchParams.get('yearA') ?? new Date().getFullYear());
  const yearB = Number(searchParams.get('yearB') ?? yearA - 1);
  const today = new Date().toISOString().split('T')[0];

  const endDate = (year: number) =>
    year === new Date().getFullYear() ? today : `${year}-12-31`;

  const reportParams = (year: number) => ({
    property: `properties/${process.env.GA4_PROPERTY_ID}`,
    dateRanges: [{ startDate: `${year}-01-01`, endDate: endDate(year) }],
    dimensions: [{ name: 'yearMonth' }],
    metrics: [{ name: 'sessions' }, { name: 'conversions' }],
    orderBys: [{ dimension: { dimensionName: 'yearMonth' } }],
  });

  try {
    const [[resA], [resB]] = await Promise.all([
      client.runReport(reportParams(yearA)),
      client.runReport(reportParams(yearB)),
    ]);

    return NextResponse.json({
      yearA,
      yearB,
      cvrA: parseCvr(resA.rows ?? []),
      cvrB: parseCvr(resB.rows ?? []),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'GA4 error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
