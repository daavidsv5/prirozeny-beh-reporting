import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';

// Roční přehled: GA4 návštěvy a konverze za celé roky (nebo 1. 1. až cutoff).
// ?years=2024,2025&cutoff=YYYY-MM-DD&period=full|ytd&device=all|desktop|mobile|tablet&country=cz

const client = new BetaAnalyticsDataClient({
  credentials: {
    client_email: process.env.GA4_CLIENT_EMAIL,
    private_key: process.env.GA4_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
});

const PROPERTY_IDS: Record<string, string | undefined> = {
  cz: process.env.GA4_PROPERTY_ID,
};

// Metrika konverzí stejná jako na Měsíčním přehledu
const METRIC_SINGLE = 'conversions';
const METRIC_ALL = 'conversions';

type YearPoint = { year: number; sessions: number; conversions: number };

// GA4 device filter — 'all' means no filter at all
const DEVICES = ['desktop', 'mobile', 'tablet'] as const;
type Device = typeof DEVICES[number] | 'all';

function deviceFilter(device: Device) {
  if (device === 'all') return undefined;
  return {
    filter: {
      fieldName: 'deviceCategory',
      stringFilter: { value: device, matchType: 'EXACT' as const },
    },
  };
}

function parseDevice(raw: string | null): Device {
  return (DEVICES as readonly string[]).includes(raw ?? '') ? (raw as Device) : 'all';
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Konec období pro daný rok: ytd = stejný den jako cutoff, full = 31. 12.; nikdy po cutoffDate. */
function endDate(year: number, cutoffDate: string, period: 'ytd' | 'full'): string {
  let mmdd = period === 'ytd' ? cutoffDate.slice(5) : '12-31';
  if (mmdd === '02-29' && !isLeap(year)) mmdd = '02-28';
  const end = `${year}-${mmdd}`;
  return end > cutoffDate ? cutoffDate : end;
}

async function fetchYear(propertyId: string, year: number, end: string, device: Device, metric: string): Promise<YearPoint> {
  const [res] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: `${year}-01-01`, endDate: end }],
    metrics: [{ name: 'sessions' }, { name: metric }],
    dimensionFilter: deviceFilter(device),
  });
  const row = res.rows?.[0];
  const sessions = Number(row?.metricValues?.[0].value ?? 0);
  const m = Number(row?.metricValues?.[1].value ?? 0);
  // sessionConversionRate je podíl (0–1) → převod na počet konvertujících návštěv
  const conversions = metric === 'sessionConversionRate' ? m * sessions : m;
  return { year, sessions, conversions };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cutoff = searchParams.get('cutoff') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
    return NextResponse.json({ error: 'Invalid cutoff' }, { status: 400 });
  }
  const period = searchParams.get('period') === 'ytd' ? 'ytd' : 'full';
  const device = parseDevice(searchParams.get('device'));
  const country = searchParams.get('country') ?? 'cz';
  const years = (searchParams.get('years') ?? '')
    .split(',')
    .map(Number)
    .filter(y => Number.isInteger(y) && y >= 2015 && y <= +cutoff.slice(0, 4))
    .slice(0, 12);

  const countries = country === 'all'
    ? Object.keys(PROPERTY_IDS).filter(c => PROPERTY_IDS[c])
    : PROPERTY_IDS[country] ? [country] : [];
  if (countries.length === 0) return NextResponse.json({ error: 'Unknown country' }, { status: 400 });
  const metric = country === 'all' ? METRIC_ALL : METRIC_SINGLE;

  try {
    const points = await Promise.all(years.map(async y => {
      const end = endDate(y, cutoff, period);
      const parts = await Promise.all(countries.map(c => fetchYear(PROPERTY_IDS[c]!, y, end, device, metric)));
      return parts.reduce((acc, p) => ({
        year: y,
        sessions: acc.sessions + p.sessions,
        conversions: acc.conversions + p.conversions,
      }), { year: y, sessions: 0, conversions: 0 });
    }));
    return NextResponse.json({ years: points });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'GA4 error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
