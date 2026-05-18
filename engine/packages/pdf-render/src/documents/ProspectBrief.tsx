import React from 'react';
import { Document, Page, View, Text, StyleSheet, Svg, Path } from '../pdf-elements.js';
import { COLOURS, FONT, SPACING } from '../theme.js';
import { Icon, type IconName } from '../icons.js';

// ─── Data types ────────────────────────────────────────────────────────────

export interface ProspectBriefData {
  brandName: string;
  url: string;
  spelling: {
    providedName?: string;
    correctName: string;
    note?: string;
  };
  founder: {
    name: string;
    background: string;
    employers: string[];
    education?: string;
    publicProfile: {
      linkedIn?: string;
      podcasts?: string[];
      interviews?: string[];
    };
    voiceAndTone: {
      description: string;
      examples: string[];
    };
    selfNamedPainPoints: Array<{
      quote: string;
      source: string;
      year?: string;
    }>;
    caresAbout: string[];
  };
  positioning: string;
  location: {
    registered: string;
    trading?: string;
    localHook?: string;
  };
  stats: Array<{ label: string; value: string; sub?: string }>;
  execSummary: {
    whatTheyActuallyDo: string;
    revenueModel: string;
    distinctiveVsCorporate: string;
    localOrSpellingIntel?: string;
  };
  opsTells: Array<{
    icon: string;
    title: string;
    evidence: string;
  }>;
  pipelines: Array<{
    rank: 1 | 2 | 3;
    name: string;
    qualifier: string;
    briefIn: string;
    trigger: string;
    workOut: string;
    replaces: string;
    whyItFits: string;
    hoursPerWeek?: string;
  }>;
  callTactics: {
    homeworkHooks: Array<{ label: string; openingLine: string }>;
    theOneQuestion: { question: string; whyThisQuestion: string };
    dontMention: string[];
  };
  risks: Array<{
    category: 'vertical-fit' | 'price-sensitivity' | 'decision-making' | 'trust-pace' | 'scope-creep' | 'competitor-risk';
    title: string;
    detail: string;
  }>;
  meetingDate?: string;
  preparedAt: string;
}

// ─── Styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    backgroundColor: COLOURS.white,
    paddingTop:        SPACING.xl,
    paddingBottom:     48,
    paddingHorizontal: SPACING.xl,
    fontFamily:        FONT.family,
  },

  footer: {
    position: 'absolute',
    bottom: 16,
    left: SPACING.xl,
    right: SPACING.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 0.5,
    borderTopColor: COLOURS.lightGrey,
    paddingTop: 6,
  },
  footerBrand: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.coral,
    letterSpacing: 0.6,
  },
  footerMeta: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    color: COLOURS.midGrey,
  },

  coverHeader: {
    backgroundColor: COLOURS.coral,
    borderRadius: 6,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
    gap: 14,
  },
  coverHeaderText: { flex: 1 },
  coverEyebrow: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    fontWeight: 500,
    color: COLOURS.white,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    opacity: 0.8,
    marginBottom: 4,
  },
  coverBrand: {
    fontSize: FONT.sizes.xxl,
    fontFamily: FONT.editorial,
    color: COLOURS.white,
    marginBottom: 4,
    lineHeight: 1.1,
  },
  coverSubtitle: {
    fontSize: FONT.sizes.sm,
    fontFamily: FONT.family,
    color: COLOURS.white,
    opacity: 0.9,
  },

  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: SPACING.md,
  },
  statCard: { width: '33.33%', paddingRight: 6, paddingBottom: 6 },
  statCardInner: {
    backgroundColor: COLOURS.offWhite,
    borderRadius: 5,
    padding: 10,
    borderWidth: 0.5,
    borderColor: COLOURS.navyBorder,
  },
  statLabel: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    fontWeight: 500,
    color: COLOURS.navy,
    opacity: 0.7,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  statValue: {
    fontSize: FONT.sizes.xl,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.navy,
    lineHeight: 1.1,
  },
  statSub: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    color: COLOURS.navy,
    opacity: 0.6,
    marginTop: 1,
  },

  tocContainer: { marginBottom: SPACING.md },
  tocTitle: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.midGrey,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  tocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOURS.lightGrey,
  },
  tocNum: {
    fontSize: FONT.sizes.body,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.coral,
    width: 24,
  },
  tocLabel: {
    flex: 1,
    fontSize: FONT.sizes.body,
    fontFamily: FONT.family,
    fontWeight: 500,
    color: COLOURS.navy,
  },
  tocPage: {
    fontSize: FONT.sizes.body,
    fontFamily: FONT.family,
    color: COLOURS.midGrey,
  },

  sectionStrip: {
    backgroundColor: COLOURS.navy,
    borderRadius: 5,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
    gap: 10,
  },
  sectionNum: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.white,
    opacity: 0.55,
    textTransform: 'uppercase',
    marginRight: 2,
  },
  sectionTitle: {
    flex: 1,
    fontSize: FONT.sizes.md,
    fontFamily: FONT.family,
    fontWeight: 700,
    color: COLOURS.white,
    letterSpacing: 0.3,
  },

  cardRow: { flexDirection: 'row', marginBottom: 8 },
  cardCellLeft:  { flex: 1, paddingRight: 5 },
  cardCellRight: { flex: 1, paddingLeft: 5 },
  cardFull: { marginBottom: 8 },
  card: {
    backgroundColor: COLOURS.white,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: COLOURS.lightGrey,
    padding: 12,
  },
  cardTitle: {
    fontSize: FONT.sizes.md,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.navy,
    marginBottom: 5,
  },
  cardBody: {
    fontSize: FONT.sizes.body,
    fontFamily: FONT.family,
    color: COLOURS.black,
    lineHeight: 1.55,
  },
  cardMuted: {
    fontSize: FONT.sizes.sm,
    fontFamily: FONT.family,
    color: COLOURS.midGrey,
    lineHeight: 1.5,
  },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, gap: 4 },
  pill: {
    backgroundColor: COLOURS.offWhite,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderWidth: 0.5,
    borderColor: COLOURS.navyBorder,
  },
  pillText: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    color: COLOURS.navy,
  },

  coralEm: {
    color: COLOURS.coral,
    fontStyle: 'italic',
    fontWeight: 500,
  },

  // Block-level coral italic quote with left border
  quoteBlock: {
    fontFamily: FONT.family,
    fontWeight: 500,
    fontStyle: 'italic',
    fontSize: FONT.sizes.body,
    color: COLOURS.coral,
    lineHeight: 1.4,
    marginBottom: 3,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: COLOURS.coral,
  },

  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
    gap: 5,
  },

  pipelineCard: {
    marginBottom: 8,
    backgroundColor: COLOURS.white,
    borderWidth: 0.5,
    borderColor: COLOURS.lightGrey,
    padding: 12,
  },
  pipelineCardCoral: {
    borderLeftWidth: 3,
    borderLeftColor: COLOURS.coral,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  pipelineCardNavy: {
    borderLeftWidth: 3,
    borderLeftColor: COLOURS.navy,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  pipelineCardAmber: {
    borderLeftWidth: 3,
    borderLeftColor: COLOURS.amber,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  pipelinePillCoral: {
    backgroundColor: COLOURS.coral,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  pipelinePillNavy: {
    backgroundColor: COLOURS.navy,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  pipelinePillAmber: {
    backgroundColor: COLOURS.amber,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  pipelinePillText: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.white,
  },
  pipelinePillTextAmber: {
    fontSize: FONT.sizes.xs,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.navy,
  },
  pipelineName: {
    fontSize: FONT.sizes.md,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.navy,
    marginBottom: 2,
  },
  pipelineQualifier: {
    fontSize: FONT.sizes.sm,
    fontFamily: FONT.family,
    color: COLOURS.midGrey,
    marginBottom: 8,
  },
  pipelineRow: { flexDirection: 'row', marginBottom: 3 },
  pipelineLabel: {
    fontSize: FONT.sizes.body,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.navy,
    width: 62,
  },
  pipelineValue: {
    flex: 1,
    fontSize: FONT.sizes.body,
    fontFamily: FONT.family,
    color: COLOURS.black,
    lineHeight: 1.5,
  },

  oneQuestionCard: {
    backgroundColor: COLOURS.white,
    borderLeftWidth: 3,
    borderLeftColor: COLOURS.coral,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    borderWidth: 0.5,
    borderColor: COLOURS.lightGrey,
    padding: 12,
    marginBottom: 8,
  },
  oneQuestionText: {
    fontSize: FONT.sizes.lg,
    fontFamily: FONT.editorial,
    color: COLOURS.navy,
    lineHeight: 1.4,
    marginVertical: 4,
  },
  dontMentionCard: {
    backgroundColor: COLOURS.white,
    borderLeftWidth: 3,
    borderLeftColor: COLOURS.amber,
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    borderWidth: 0.5,
    borderColor: COLOURS.lightGrey,
    padding: 12,
    marginBottom: 8,
  },
  closeCard: {
    backgroundColor: COLOURS.navy,
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
  },
  closeTitle: {
    fontSize: FONT.sizes.md,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.white,
    marginBottom: 5,
  },
  closeBody: {
    fontSize: FONT.sizes.body,
    fontFamily: FONT.family,
    color: COLOURS.white,
    opacity: 0.9,
    lineHeight: 1.55,
  },
  closeHighlight: { color: COLOURS.coral, fontWeight: 600 },

  bulletRow: { flexDirection: 'row', marginBottom: 3 },
  bulletDot: {
    fontSize: FONT.sizes.body,
    fontFamily: FONT.family,
    fontWeight: 600,
    color: COLOURS.coral,
    marginRight: 5,
    lineHeight: 1.55,
    width: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: FONT.sizes.body,
    fontFamily: FONT.family,
    color: COLOURS.black,
    lineHeight: 1.55,
  },
  bulletBold: { fontWeight: 600 },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

// Chunk array into consecutive pairs for row-pair layout (react-pdf can
// page-break between rows in a column container, unlike flexWrap).
function pairs<T>(arr: T[]): [T, T | undefined][] {
  const out: [T, T | undefined][] = [];
  for (let i = 0; i < arr.length; i += 2) {
    out.push([arr[i]!, arr[i + 1]]);
  }
  return out;
}

function BulletItem({ text }: { text: string }) {
  return (
    <View style={s.bulletRow}>
      <Text style={s.bulletDot}>·</Text>
      <Text style={s.bulletText}>{text}</Text>
    </View>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      <Text style={s.cardBody}>{body}</Text>
    </View>
  );
}

function IconCard({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View style={s.card}>
      <View style={s.cardTitleRow}>
        <Icon name={icon} size={12} color={COLOURS.coral} />
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      <Text style={s.cardBody}>{body}</Text>
    </View>
  );
}

// ─── SprigMark ─────────────────────────────────────────────────────────────

function SprigMark({ size = 28 }: { size?: number }) {
  const h = Math.round(size * 1.25);
  return (
    <Svg viewBox="0 0 32 40" width={size} height={h}>
      <Path d="M16 4 C 10 8, 7 14, 8 20 C 9 24, 13 26, 16 26 C 19 26, 23 24, 24 20 C 25 14, 22 8, 16 4 Z" fill={COLOURS.white} opacity={0.5} />
      <Path d="M16 26 L 16 36" stroke={COLOURS.white} strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.5} />
    </Svg>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function Footer({ brandName }: { brandName: string }) {
  return (
    <View fixed style={s.footer}>
      <Text style={s.footerBrand}>SPRIGLY</Text>
      <Text style={s.footerMeta}>{brandName} · Confidential</Text>
      <Text style={s.footerMeta} render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} />
    </View>
  );
}

// ─── Section strip ──────────────────────────────────────────────────────────

function SectionStrip({ num, title, icon }: { num: string; title: string; icon: IconName }) {
  return (
    <View style={s.sectionStrip}>
      <Icon name={icon} size={14} color={COLOURS.white} />
      <Text style={s.sectionNum}>{num} ·</Text>
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

// ─── Page 1: Cover ──────────────────────────────────────────────────────────

const TOC_SECTIONS = [
  { num: '01', label: 'Exec Summary',      page: 2 },
  { num: '02', label: 'Founder',           page: 3 },
  { num: '03', label: 'Operational Tells', page: 4 },
  { num: '04', label: 'Pipelines',         page: 5 },
  { num: '05', label: 'Call Tactics',      page: 6 },
  { num: '06', label: 'Risks',             page: 7 },
];

function CoverPage({ data }: { data: ProspectBriefData }) {
  console.log('[CoverPage] stats value:', JSON.stringify(data.stats));
  console.log('[CoverPage] stats is array?', Array.isArray(data.stats));

  const locationDisplay = data.location.trading ?? data.location.registered;
  const subtitle = [data.founder.name, data.positioning, locationDisplay].filter(Boolean).join(' · ');
  const metaParts = [
    data.url,
    data.meetingDate && `Meeting: ${data.meetingDate}`,
    `Prepared: ${data.preparedAt}`,
  ].filter(Boolean) as string[];

  const stats = Array.isArray(data.stats) ? data.stats : [];

  return (
    <Page size="A4" style={s.page}>
      <View style={s.coverHeader}>
        <SprigMark size={26} />
        <View style={s.coverHeaderText}>
          <Text style={s.coverEyebrow}>Sprigly · Discovery prep</Text>
          <Text style={s.coverBrand}>{data.brandName}</Text>
          {subtitle.length > 0 && <Text style={s.coverSubtitle}>{subtitle}</Text>}
        </View>
      </View>

      <Text style={{ ...s.cardMuted, marginBottom: SPACING.md }}>{metaParts.join(' · ')}</Text>

      <View style={s.statGrid}>
        {stats.map((stat, i) => (
          <View key={i} style={s.statCard}>
            <View style={s.statCardInner}>
              <Text style={s.statLabel}>{stat.label}</Text>
              <Text style={s.statValue}>{stat.value}</Text>
              {stat.sub !== undefined && <Text style={s.statSub}>{stat.sub}</Text>}
            </View>
          </View>
        ))}
      </View>

      <View style={s.tocContainer}>
        <Text style={s.tocTitle}>Contents</Text>
        {TOC_SECTIONS.map((row) => (
          <View key={row.num} style={s.tocRow}>
            <Text style={s.tocNum}>{row.num}</Text>
            <Text style={s.tocLabel}>{row.label}</Text>
            <Text style={s.tocPage}>p.{row.page}</Text>
          </View>
        ))}
      </View>

      <Footer brandName={data.brandName} />
    </Page>
  );
}

// ─── Page 2: Exec Summary ───────────────────────────────────────────────────

function ExecSummaryPage({ data }: { data: ProspectBriefData }) {
  const es = data.execSummary;
  const cards = [
    { title: 'What they actually do',     body: es.whatTheyActuallyDo },
    { title: 'Revenue model',             body: es.revenueModel },
    { title: 'What makes them distinctive', body: es.distinctiveVsCorporate },
  ];
  if (es.localOrSpellingIntel !== undefined) {
    cards.push({ title: 'Local and spelling intel', body: es.localOrSpellingIntel });
  }

  return (
    <Page size="A4" style={s.page}>
      <SectionStrip num="01" title="Exec Summary" icon="layout-dashboard" />
      {pairs(cards).map(([left, right], i) => (
        <View key={i} wrap={false} style={s.cardRow}>
          <View style={s.cardCellLeft}>
            <InfoCard title={left.title} body={left.body} />
          </View>
          {right !== undefined && (
            <View style={s.cardCellRight}>
              <InfoCard title={right.title} body={right.body} />
            </View>
          )}
        </View>
      ))}
      <Footer brandName={data.brandName} />
    </Page>
  );
}

// ─── Page 3: Founder ────────────────────────────────────────────────────────

function buildPublicProfileText(pub: ProspectBriefData['founder']['publicProfile']): string {
  const parts: string[] = [];
  if (pub.linkedIn)            parts.push(`LinkedIn: ${pub.linkedIn}`);
  if (pub.podcasts?.length)    parts.push(`Podcasts: ${pub.podcasts.join(', ')}`);
  if (pub.interviews?.length)  parts.push(`Interviews: ${pub.interviews.join(', ')}`);
  return parts.join('. ') || 'No public profile found.';
}

function FounderPage({ data }: { data: ProspectBriefData }) {
  const { founder } = data;
  const publicProfileText = buildPublicProfileText(founder.publicProfile);

  return (
    <Page size="A4" style={s.page}>
      <SectionStrip num="02" title="Founder" icon="user" />

      {/* Row 1: Background + Voice and Tone */}
      <View wrap={false} style={s.cardRow}>
        <View style={s.cardCellLeft}>
          <View style={s.card}>
            <Text style={s.cardTitle}>Background</Text>
            <Text style={s.cardBody}>{founder.background}</Text>
            {founder.employers.length > 0 && (
              <View style={s.pillRow}>
                {founder.employers.map((emp, i) => (
                  <View key={i} style={s.pill}>
                    <Text style={s.pillText}>{emp}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
        <View style={s.cardCellRight}>
          <View style={s.card}>
            <Text style={s.cardTitle}>Voice and tone</Text>
            <Text style={s.cardBody}>{founder.voiceAndTone.description}</Text>
            {founder.voiceAndTone.examples.length > 0 && (
              <View style={{ marginTop: 6 }}>
                {founder.voiceAndTone.examples.map((ex, i) => (
                  <Text key={i} style={s.coralEm}>"{ex}"</Text>
                ))}
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Row 2: Public Profile + Self-named pain points */}
      <View wrap={false} style={s.cardRow}>
        <View style={s.cardCellLeft}>
          <InfoCard title="Public profile" body={publicProfileText} />
        </View>
        <View style={s.cardCellRight}>
          <View style={s.card}>
            <Text style={s.cardTitle}>Self-named pain points</Text>
            {founder.selfNamedPainPoints.length === 0 && (
              <Text style={s.cardMuted}>No direct quotes found in research.</Text>
            )}
            {founder.selfNamedPainPoints.map((pt, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <Text style={s.quoteBlock}>"{pt.quote}"</Text>
                <Text style={s.cardMuted}>
                  {pt.source}{pt.year !== undefined ? `, ${pt.year}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Row 3: What they care about */}
      <View wrap={false} style={s.cardRow}>
        <View style={s.cardCellLeft}>
          <View style={s.card}>
            <Text style={s.cardTitle}>What they care about</Text>
            {founder.caresAbout.map((item, i) => (
              <BulletItem key={i} text={item} />
            ))}
          </View>
        </View>
        <View style={s.cardCellRight} />
      </View>

      <Footer brandName={data.brandName} />
    </Page>
  );
}

// ─── Page 4: Ops Tells ──────────────────────────────────────────────────────

const ICON_ALIASES: Record<string, IconName> = {
  'settings':        'tools',
  'wrench':          'tools',
  'gear':            'tools',
  'chart':           'layout-dashboard',
  'bar-chart':       'layout-dashboard',
  'chart-bar':       'layout-dashboard',
  'check':           'alert-circle',
  'check-circle':    'alert-circle',
  'calendar':        'clock',
  'time':            'clock',
  'person':          'user',
  'people':          'users',
  'team':            'users',
  'globe':           'world',
  'link':            'world',
  'document':        'file-text',
  'file':            'file-text',
  'chat':            'message',
  'comment':         'message',
  'envelope':        'mail',
  'email':           'mail',
  'box':             'package',
  'warning':         'alert-triangle',
  'exclamation':     'alert-triangle',
  'magnify':         'search',
  'magnifying-glass': 'search',
};

function resolveIcon(raw: string): IconName {
  if (raw in ICON_ALIASES) return ICON_ALIASES[raw]!;
  return 'info-circle';
}

function OpsTellsPage({ data }: { data: ProspectBriefData }) {
  const tells = Array.isArray(data.opsTells) ? data.opsTells : [];
  return (
    <Page size="A4" style={s.page}>
      <SectionStrip num="03" title="Operational Tells" icon="tools" />
      {pairs(tells).map(([left, right], i) => (
        <View key={i} wrap={false} style={s.cardRow}>
          <View style={s.cardCellLeft}>
            <IconCard icon={resolveIcon(left.icon)} title={left.title} body={left.evidence} />
          </View>
          {right !== undefined && (
            <View style={s.cardCellRight}>
              <IconCard icon={resolveIcon(right.icon)} title={right.title} body={right.evidence} />
            </View>
          )}
        </View>
      ))}
      <Footer brandName={data.brandName} />
    </Page>
  );
}

// ─── Page 5: Pipelines ──────────────────────────────────────────────────────

const PIPELINE_STYLES = [
  { card: s.pipelineCardCoral, pill: s.pipelinePillCoral, pillText: s.pipelinePillText,      label: 'Pipeline 1 · Primary'   },
  { card: s.pipelineCardNavy,  pill: s.pipelinePillNavy,  pillText: s.pipelinePillText,      label: 'Pipeline 2 · Secondary' },
  { card: s.pipelineCardAmber, pill: s.pipelinePillAmber, pillText: s.pipelinePillTextAmber, label: 'Pipeline 3 · Strategic'  },
];

function PipelinesPage({ data }: { data: ProspectBriefData }) {
  const sorted = [...data.pipelines].sort((a, b) => a.rank - b.rank).slice(0, 3);
  return (
    <Page size="A4" style={s.page}>
      <SectionStrip num="04" title="Pipelines" icon="arrow-right" />
      {sorted.map((pipeline, i) => {
        const style = PIPELINE_STYLES[i] ?? PIPELINE_STYLES[0]!;
        const replacesText = pipeline.hoursPerWeek !== undefined
          ? `${pipeline.replaces} (~${pipeline.hoursPerWeek}/week)`
          : pipeline.replaces;
        return (
          <View key={i} wrap={false} style={[s.pipelineCard, style.card]}>
            <View style={style.pill}>
              <Text style={style.pillText}>{style.label}</Text>
            </View>
            <Text style={s.pipelineName}>{pipeline.name}</Text>
            <Text style={s.pipelineQualifier}>{pipeline.qualifier}</Text>
            {([
              ['Brief in',    pipeline.briefIn],
              ['Trigger',     pipeline.trigger],
              ['Work out',    pipeline.workOut],
              ['Replaces',    replacesText],
              ['Why it fits', pipeline.whyItFits],
            ] as [string, string][]).map(([label, value]) => (
              <View key={label} style={s.pipelineRow}>
                <Text style={s.pipelineLabel}>{label}:</Text>
                <Text style={s.pipelineValue}>{value}</Text>
              </View>
            ))}
          </View>
        );
      })}
      <Footer brandName={data.brandName} />
    </Page>
  );
}

// ─── Page 6: Call Tactics ───────────────────────────────────────────────────

function CallTacticsPage({ data }: { data: ProspectBriefData }) {
  console.log('[CallTacticsPage] homeworkHooks is array?', Array.isArray(data.callTactics.homeworkHooks));
  console.log('[CallTacticsPage] dontMention is array?', Array.isArray(data.callTactics.dontMention));
  const ct = {
    ...data.callTactics,
    homeworkHooks: Array.isArray(data.callTactics.homeworkHooks) ? data.callTactics.homeworkHooks : [],
    dontMention:   Array.isArray(data.callTactics.dontMention)   ? data.callTactics.dontMention   : [],
  };
  return (
    <Page size="A4" style={s.page}>
      <SectionStrip num="05" title="Call Tactics" icon="message" />

      <View wrap={false} style={s.cardFull}>
        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Icon name="bulb" size={12} color={COLOURS.coral} />
            <Text style={s.cardTitle}>Homework hooks</Text>
          </View>
          {ct.homeworkHooks.map((hook, i) => (
            <View key={i} style={s.bulletRow}>
              <Text style={s.bulletDot}>·</Text>
              <Text style={s.bulletText}>
                <Text style={s.bulletBold}>{hook.label}</Text>
                {' — '}
                <Text style={s.coralEm}>"{hook.openingLine}"</Text>
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View wrap={false} style={s.oneQuestionCard}>
        <View style={s.cardTitleRow}>
          <Icon name="message-circle" size={12} color={COLOURS.coral} />
          <Text style={s.cardTitle}>The one question</Text>
        </View>
        <Text style={s.oneQuestionText}>"{ct.theOneQuestion.question}"</Text>
        <Text style={s.cardMuted}>{ct.theOneQuestion.whyThisQuestion}</Text>
      </View>

      <View wrap={false} style={s.dontMentionCard}>
        <View style={s.cardTitleRow}>
          <Icon name="eye-off" size={12} color={COLOURS.amber} />
          <Text style={s.cardTitle}>Don't mention</Text>
        </View>
        {ct.dontMention.map((item, i) => (
          <BulletItem key={i} text={item} />
        ))}
      </View>

      <View wrap={false} style={s.closeCard}>
        <Text style={s.closeTitle}>The three-fragment close</Text>
        <Text style={s.closeBody}>
          End the call the Sprigly way:{' '}
          <Text style={s.closeHighlight}>20 minutes. Free. No pitch.</Text>
          {' '}Next step is the Audit, one page, by end of week.
        </Text>
      </View>

      <Footer brandName={data.brandName} />
    </Page>
  );
}

// ─── Page 7: Risks ──────────────────────────────────────────────────────────

function RisksPage({ data }: { data: ProspectBriefData }) {
  return (
    <Page size="A4" style={s.page}>
      <SectionStrip num="06" title="Risks" icon="alert-triangle" />
      {pairs(data.risks).map(([left, right], i) => (
        <View key={i} wrap={false} style={s.cardRow}>
          <View style={s.cardCellLeft}>
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Icon name="alert-circle" size={12} color={COLOURS.coral} />
                <Text style={s.cardTitle}>{left.title}</Text>
              </View>
              <Text style={s.cardBody}>{left.detail}</Text>
            </View>
          </View>
          {right !== undefined && (
            <View style={s.cardCellRight}>
              <View style={s.card}>
                <View style={s.cardTitleRow}>
                  <Icon name="alert-circle" size={12} color={COLOURS.coral} />
                  <Text style={s.cardTitle}>{right.title}</Text>
                </View>
                <Text style={s.cardBody}>{right.detail}</Text>
              </View>
            </View>
          )}
        </View>
      ))}
      <Footer brandName={data.brandName} />
    </Page>
  );
}

// ─── Document ───────────────────────────────────────────────────────────────

export function ProspectBrief({ data }: { data: ProspectBriefData }) {
  return (
    <Document title={`Prospect Brief: ${data.brandName}`} author="Sprigly">
      <CoverPage data={data} />
      <ExecSummaryPage data={data} />
      <FounderPage data={data} />
      <OpsTellsPage data={data} />
      <PipelinesPage data={data} />
      <CallTacticsPage data={data} />
      <RisksPage data={data} />
    </Document>
  );
}
