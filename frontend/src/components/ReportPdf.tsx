import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { SIGNALS } from '../lib/config';
import { severityLabel } from '../lib/scoring';
import { fmtDateTime, fmtNum, toDisplay, unitFor } from '../lib/units';
import { rangeSummary } from '../lib/zones';
import type { Explanation, Scan, Settings, Severity, Vehicle } from '../lib/types';

const color: Record<Severity, string> = { normal: '#166B43', watch: '#8A4B00', alert: '#B42318', none: '#5B5870' };
const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, fontFamily: 'Helvetica', color: '#1A1825' },
  brand: { fontSize: 9, color: '#5B3CD6', fontFamily: 'Helvetica-Bold', letterSpacing: 1.2, marginBottom: 6 },
  h1: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  muted: { color: '#4A4760' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  score: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 10, width: 86, height: 70 },
  scoreNum: { fontSize: 26, fontFamily: 'Helvetica-Bold' },
  h2: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  th: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#B9B5CE', paddingBottom: 4, fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  tr: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderColor: '#DAD7E7' },
  c1: { width: '22%' }, c2: { width: '34%', paddingRight: 12 }, c3: { width: '22%', paddingLeft: 2 }, c4: { width: '22%', textAlign: 'right' },
  small: { fontSize: 8, color: '#4A4760' },
  note: { marginTop: 3, fontSize: 8.5, color: '#4A4760' },
  foot: { position: 'absolute', bottom: 22, left: 36, right: 36, fontSize: 8, color: '#7A7790', flexDirection: 'row', justifyContent: 'space-between' },
});

export function ReportPdf({ vehicle, scan, settings, explanation }: {
  vehicle: Vehicle; scan: Scan; settings: Settings; explanation: Explanation | null;
}) {
  const rows = scan.signals;
  return (
    <Document title={`ApexDriver report - ${vehicle.name}`} author="ApexDriver">
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>APEXDRIVER HEALTH REPORT</Text>
        <View style={s.rowTop}>
          <View>
            <Text style={s.h1}>{vehicle.name}{vehicle.modelYear ? ` (${vehicle.modelYear})` : ''}</Text>
            <Text style={s.muted}>{fmtDateTime(scan.startedAt)} - {scan.durationMin} min - {scan.source}</Text>
            <Text style={s.muted}>
              Warm-up {Math.round(scan.states.warmup)}% - Idle {Math.round(scan.states.idle)}% - Driving {Math.round(scan.states.driving)}%
            </Text>
            <Text style={s.muted}>Based on {scan.scoredSignals} of {scan.totalSignals} scored signals</Text>
          </View>
          <View style={[s.score, { borderColor: color[scan.severity] }]}>
            <Text style={[s.scoreNum, { color: color[scan.severity] }]}>{scan.score}</Text>
            <Text style={{ color: color[scan.severity], fontFamily: 'Helvetica-Bold' }}>{severityLabel(scan.severity)}</Text>
          </View>
        </View>

        {explanation && (
          <View>
            <Text style={s.h2}>Summary</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 3 }}>{explanation.headline}</Text>
            <Text>{explanation.summary}</Text>
            <Text style={s.note}>{explanation.meaning}</Text>
          </View>
        )}

        <Text style={s.h2}>Signals and ranges used</Text>
        <View style={s.th}>
          <Text style={s.c1}>Signal</Text><Text style={s.c2}>Range used</Text><Text style={s.c3}>Min / Avg / Max</Text><Text style={s.c4}>Status</Text>
        </View>
        {rows.map((r) => {
          const u = unitFor(r.key, settings);
          const f = (v: number) => fmtNum(toDisplay(r.key, v, settings), r.key);
          return (
            <View key={r.key} style={s.tr} wrap={false}>
              <Text style={s.c1}>{SIGNALS[r.key].label}</Text>
              <Text style={[s.c2, s.small]}>{rangeSummary(r.key, settings)}</Text>
              <Text style={s.c3}>{r.available ? `${f(r.min)} / ${f(r.avg)} / ${f(r.max)} ${u}` : '-'}</Text>
              <View style={s.c4}>
                <Text style={{ color: color[r.severity], fontFamily: 'Helvetica-Bold', textAlign: 'right' }}>
                  {!r.available ? 'No data' : r.scored ? severityLabel(r.severity) : 'Context'}
                </Text>
                {r.scored && r.available && (
                  <Text style={[s.small, { textAlign: 'right' }]}>
                    {Math.round(r.pctNormal)}% / {Math.round(r.pctWatch)}% / {Math.round(r.pctAlert)}% of time
                  </Text>
                )}
              </View>
            </View>
          );
        })}

        {scan.mixture && (
          <View wrap={false}>
            <Text style={s.h2}>Fuel mixture (tuning indicator, not scored)</Text>
            <Text>Median air-fuel ratio {scan.mixture.median.toFixed(1)}:1; {Math.round(scan.mixture.pctRich)}% of running time richer than 12.5:1. Scale and fuel type are unverified.</Text>
          </View>
        )}

        <Text style={s.h2}>Notes</Text>
        <Text style={s.note}>This report reflects only the uploaded log. It is not a mechanic's diagnosis.</Text>
        <Text style={s.note}>Ranges are generic defaults and are not tuned to this vehicle.</Text>
        {scan.simulated && <Text style={s.note}>Prototype: this result comes from the simulator, not from real analysis of a file.</Text>}
        <View style={s.foot} fixed>
          <Text>Generated by ApexDriver (prototype)</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
